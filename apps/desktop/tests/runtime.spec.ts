import { describe, expect, it } from 'vitest'
import {
  DESKTOP_NODE_EXECUTABLE,
  desktopArguments,
  isApplicationNavigation,
  isDesktopHostShutdown,
  isExternalWebUrl,
  packagedHostEntry,
  packagedNodeExecutable,
  parseDesktopHostMessage,
  resolveDesktopWebServer,
  resolveNodeExecutable,
  webServerUrl,
} from '../src/runtime.ts'

describe('desktop runtime decisions', () => {
  it('separates Electron launcher arguments', () => {
    expect(desktopArguments(['electron', '.', '--port', '3080'], true)).toEqual(['--port', '3080'])
    expect(desktopArguments(['dsh-desktop', '--port', '3080'], false)).toEqual(['--port', '3080'])
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
