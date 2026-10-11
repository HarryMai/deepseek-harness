/** Download and verify the target Electron archive with visible progress and an inactivity deadline. */

import { downloadArtifact } from '@electron/get'
import { resolveElectronDownloadTimeout } from './desktop-release-environment.mjs'

export { resolveElectronDownloadTimeout } from './desktop-release-environment.mjs'

/**
 * @param version Locked Electron version.
 * @param platform Target Electron platform.
 * @param arch Target Electron architecture.
 * @param cacheRoot Shared archive cache; archives retain Electron's checksum verification.
 * @param environment Packaging environment containing the optional inactivity deadline.
 * @param download Electron downloader, replaceable at the network test boundary.
 * @returns Verified archive path; stalled requests are aborted and awaited before rejection.
 */
export async function downloadDesktopElectron(
  version: string,
  platform: string,
  arch: string,
  cacheRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
  download: typeof downloadArtifact = downloadArtifact,
): Promise<string> {
  const timeoutMs = resolveElectronDownloadTimeout(environment)
  const controller = new AbortController()
  const timeoutError = new Error(`desktop runtime: Electron ${version} ${platform}-${arch} download received no data for ${timeoutMs} ms; configure ELECTRON_MIRROR and ELECTRON_CUSTOM_DIR in the platform dotenv file, or a download proxy`)
  const timer = setTimeout(() => { controller.abort(timeoutError) }, timeoutMs)
  let reportedAt = 0
  console.log(`desktop runtime: downloading Electron ${version} ${platform}-${arch} (checking archive cache and checksums)`)
  try {
    const archive = await download({
      version, platform, arch, artifactName: 'electron', cacheRoot,
      downloadOptions: {
        quiet: true,
        signal: controller.signal,
        getProgressCallback: async ({ transferred, total }: { transferred: number; total: number | null }) => {
          timer.refresh()
          const now = performance.now()
          if (now - reportedAt < 5000) return
          reportedAt = now
          console.log(`desktop runtime: Electron download ${(transferred / 1048576).toFixed(1)} MiB${total === null ? '' : ` / ${(total / 1048576).toFixed(1)} MiB`}`)
        },
      },
    })
    console.log(`desktop runtime: Electron ${version} ${platform}-${arch} archive verified`)
    return archive
  } finally {
    clearTimeout(timer)
  }
}
