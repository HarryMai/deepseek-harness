import { describe, expect, it } from 'vitest'
import {
  DESKTOP_NODE_EXECUTABLE,
  desktopHostLogPaths,
  desktopArguments,
  isApplicationNavigation,
  isDesktopPermissionAllowed,
  isDesktopHostShutdown,
  isExternalWebUrl,
  isUnexpectedDesktopHostExit,
  packagedHostEntry,
  packagedNodeExecutable,
  parseDesktopHostMessage,
  resolveDesktopWebServer,
  resolveDesktopHostCwd,
  resolveNodeExecutable,
  webServerUrl,
} from '../src/runtime.ts'

describe('desktop runtime decisions', () => {
  it('separates Electron launcher arguments', () => {
    expect(desktopArguments(['electron', '.', '--port', '3080'], true)).toEqual(['--port', '3080'])
    expect(desktopArguments(['dsh-desktop', '--port', '3080'], false)).toEqual(['--port', '3080'])
  })

  it('uses the user home as the packaged Host cwd', () => {
    expect(resolveDesktopHostCwd(true, 'C:\\Users\\test', 'C:\\Windows\\System32'))
      .toBe('C:\\Users\\test')
    expect(resolveDesktopHostCwd(false, 'C:\\Users\\test', 'D:\\Project'))
      .toBe('D:\\Project')
  })

  it('uses the exact Node launcher passed across the Electron process boundary', () => {
    expect(resolveNodeExecutable({
      [DESKTOP_NODE_EXECUTABLE]: ' C:\\node\\node.exe ',
      npm_node_execpath: 'ignored',
    })).toBe('C:\\node\\node.exe')
    expect(resolveNodeExecutable({ npm_node_execpath: '/usr/bin/node' })).toBe('/usr/bin/node')
  })

  it('resolves packaged Windows resources without changing the development launcher', () => {
    expect(packagedNodeExecutable('C:\\application\\resources', 'win32'))
      .toBe('C:\\application\\resources\\n\\node.exe')
    expect(packagedHostEntry('C:\\application\\resources'))
      .toBe('C:\\application\\resources\\h\\desktop-host-child.js')
    expect(() => packagedNodeExecutable('/application/resources', 'linux'))
      .toThrow(/packaged Node is unavailable on linux/)
  })

  it('keeps Host logs under the Electron user-data logs directory', () => {
    expect(desktopHostLogPaths('C:\\Users\\test\\AppData\\Roaming\\Harness'))
      .toEqual({
        stdout: 'C:\\Users\\test\\AppData\\Roaming\\Harness\\logs\\host.stdout.log',
        stderr: 'C:\\Users\\test\\AppData\\Roaming\\Harness\\logs\\host.stderr.log',
      })
  })

  it('maps wildcard listeners to a reachable loopback URL and validates ports', () => {
    expect(webServerUrl('127.0.0.1', 3080)).toBe('http://127.0.0.1:3080/')
    expect(webServerUrl('0.0.0.0', 43123)).toBe('http://127.0.0.1:43123/')
    expect(() => webServerUrl('127.0.0.1', 0)).toThrow(/invalid WebServer port/)
  })

  it('reads the bound server from its isolated Loader entry context', () => {
    const server = { host: '127.0.0.1', port: 43123 }
    expect(resolveDesktopWebServer([
      { options: { id: 'other' }, ctx: { get: () => undefined } },
      { options: { id: 'webserver' }, ctx: { get: name => name === 'webServer' ? server : undefined } },
    ])).toEqual(server)
    expect(() => resolveDesktopWebServer([
      { options: { id: 'webserver' }, ctx: { get: () => undefined } },
    ])).toThrow(/no bound webserver entry/)
  })

  it('accepts only validated loopback Host messages and the shutdown command', () => {
    expect(parseDesktopHostMessage({ type: 'ready', url: 'http://127.0.0.1:43123/' }))
      .toEqual({ type: 'ready', url: 'http://127.0.0.1:43123/' })
    expect(parseDesktopHostMessage({ type: 'ready', url: 'https://127.0.0.1:43123/' })).toBeUndefined()
    expect(parseDesktopHostMessage({ type: 'ready', url: 'http://example.com:43123/' })).toBeUndefined()
    expect(parseDesktopHostMessage({ type: 'error', message: 'profile failed' }))
      .toEqual({ type: 'error', message: 'profile failed' })
    expect(parseDesktopHostMessage({ type: 'error', message: '' })).toBeUndefined()
    expect(isDesktopHostShutdown({ type: 'shutdown' })).toBe(true)
    expect(isDesktopHostShutdown({ type: 'ready' })).toBe(false)
  })

  it('allows clipboard writes only from the loaded application origin', () => {
    const application = 'http://127.0.0.1:43123/'
    expect(isDesktopPermissionAllowed('clipboard-sanitized-write', application, application)).toBe(true)
    expect(isDesktopPermissionAllowed('clipboard-sanitized-write', application, 'http://127.0.0.1:43124/'))
      .toBe(false)
    expect(isDesktopPermissionAllowed('clipboard-read', application, application)).toBe(false)
    expect(isDesktopPermissionAllowed('notifications', application, application)).toBe(false)
  })

  it('reports non-zero and signalled exits after startup', () => {
    expect(isUnexpectedDesktopHostExit(true, false, 0, null)).toBe(false)
    expect(isUnexpectedDesktopHostExit(true, false, 1, null)).toBe(true)
    expect(isUnexpectedDesktopHostExit(true, false, null, 'SIGTERM')).toBe(true)
    expect(isUnexpectedDesktopHostExit(false, false, 1, null)).toBe(false)
    expect(isUnexpectedDesktopHostExit(true, true, 1, null)).toBe(false)
  })

  it('keeps renderer navigation on one origin and filters external protocols', () => {
    const application = 'http://127.0.0.1:43123/'
    expect(isApplicationNavigation(application, 'http://127.0.0.1:43123/settings')).toBe(true)
    expect(isApplicationNavigation(application, 'https://example.com/')).toBe(false)
    expect(isApplicationNavigation(application, 'not a URL')).toBe(false)
    expect(isExternalWebUrl('https://example.com/')).toBe(true)
    expect(isExternalWebUrl('file:///etc/passwd')).toBe(false)
    expect(isExternalWebUrl('not a URL')).toBe(false)
  })
})
