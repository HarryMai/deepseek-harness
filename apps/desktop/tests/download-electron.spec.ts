import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadDesktopElectron, resolveElectronDownloadTimeout } from '../scripts/download-electron.ts'

const target = { version: '44.0.0', platform: 'darwin', arch: 'x64', cacheRoot: '/tmp/electron-cache' }

type Download = Parameters<typeof downloadDesktopElectron>[5]
type DownloadOptions = NonNullable<Parameters<NonNullable<Download>>[0]['downloadOptions']>
type Progress = { transferred: number; total: number | null; percent: number }

function stalledDownload(onOptions: (options: Parameters<NonNullable<Download>>[0]) => void): Download {
  return vi.fn<NonNullable<Download>>(async options => {
    onOptions(options)
    const { signal } = options.downloadOptions as DownloadOptions & { signal: AbortSignal }
    await new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
    })
    return '/tmp/unreachable-electron.zip'
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Electron archive download', () => {
  it('passes a quiet downloader, abort signal, and progress callback to the injected downloader', async () => {
    const progress: Progress[] = []
    let receivedSignal: AbortSignal | undefined
    const download = vi.fn<NonNullable<Download>>(async options => {
      const downloadOptions = options.downloadOptions as DownloadOptions & {
        signal: AbortSignal
        getProgressCallback: (value: Progress) => Promise<void>
      }
      receivedSignal = downloadOptions.signal
      expect(downloadOptions.quiet).toBe(true)
      await downloadOptions.getProgressCallback({ transferred: 1024, total: 2048, percent: 0.5 })
      progress.push({ transferred: 1024, total: 2048, percent: 0.5 })
      return '/tmp/electron.zip'
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(downloadDesktopElectron(target.version, target.platform, target.arch, target.cacheRoot,
      { DSH_DESKTOP_ELECTRON_DOWNLOAD_TIMEOUT_MS: '1000' }, download)).resolves.toBe('/tmp/electron.zip')

    expect(download).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(target))
    expect(receivedSignal).toBeInstanceOf(AbortSignal)
    expect(progress).toEqual([{ transferred: 1024, total: 2048, percent: 0.5 }])
    expect(log.mock.calls[0]?.[0]).toContain('downloading Electron 44.0.0 darwin-x64')
    expect(log.mock.calls.at(-1)?.[0]).toContain('Electron 44.0.0 darwin-x64 archive verified')
  })

  it('aborts a stalled download, waits for downloader cleanup, and reports the target', async () => {
    vi.useFakeTimers()
    let cleanedUp = false
    const download = stalledDownload(options => {
      const signal = (options.downloadOptions as DownloadOptions & { signal: AbortSignal }).signal
      signal.addEventListener('abort', () => { cleanedUp = true }, { once: true })
    })
    const operation = downloadDesktopElectron(target.version, target.platform, target.arch, target.cacheRoot,
      { DSH_DESKTOP_ELECTRON_DOWNLOAD_TIMEOUT_MS: '1000' }, download)
    const rejected = expect(operation).rejects.toThrow(
      'desktop runtime: Electron 44.0.0 darwin-x64 download received no data for 1000 ms; configure ELECTRON_MIRROR and ELECTRON_CUSTOM_DIR in the platform dotenv file, or a download proxy',
    )

    await vi.advanceTimersByTimeAsync(999)
    expect(cleanedUp).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    await rejected
    expect(cleanedUp).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resets the inactivity deadline for archive and checksum progress callbacks', async () => {
    vi.useFakeTimers()
    let progress!: (value: Progress) => Promise<void>
    let signal!: AbortSignal
    const download = stalledDownload(options => {
      const downloadOptions = options.downloadOptions as DownloadOptions & {
        signal: AbortSignal
        getProgressCallback: (value: Progress) => Promise<void>
      }
      signal = downloadOptions.signal
      progress = downloadOptions.getProgressCallback
    })
    const operation = downloadDesktopElectron(target.version, target.platform, target.arch, target.cacheRoot,
      { DSH_DESKTOP_ELECTRON_DOWNLOAD_TIMEOUT_MS: '1000' }, download)
    const rejected = expect(operation).rejects.toThrow(/Electron 44\.0\.0 darwin-x64 download received no data/u)
    await Promise.resolve()

    await vi.advanceTimersByTimeAsync(900)
    await progress({ transferred: 1024, total: 4096, percent: 0.25 })
    await vi.advanceTimersByTimeAsync(900)
    // A checksum request can report an unknown total and still counts as active data.
    await progress({ transferred: 2048, total: null, percent: 0 })
    await vi.advanceTimersByTimeAsync(999)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['', 'empty'], ['0', 'below minimum'], ['999', 'below minimum'], ['1000.5', 'non-integer'],
    ['1e3', 'non-integer'], ['2147483648', 'above maximum'], ['not-a-number', 'non-numeric'],
  ])('rejects %s as an invalid inactivity timeout (%s)', (value) => {
    expect(() => resolveElectronDownloadTimeout({ DSH_DESKTOP_ELECTRON_DOWNLOAD_TIMEOUT_MS: value }))
      .toThrow('DSH_DESKTOP_ELECTRON_DOWNLOAD_TIMEOUT_MS must be an integer from 1000 through 2147483647')
  })

  it('uses the default and inclusive limits for the inactivity timeout', () => {
    expect(resolveElectronDownloadTimeout({})).toBe(60_000)
    expect(resolveElectronDownloadTimeout({ DSH_DESKTOP_ELECTRON_DOWNLOAD_TIMEOUT_MS: '1000' })).toBe(1000)
    expect(resolveElectronDownloadTimeout({ DSH_DESKTOP_ELECTRON_DOWNLOAD_TIMEOUT_MS: '2147483647' })).toBe(2147483647)
  })
})
