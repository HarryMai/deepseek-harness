/** Shared, Electron-free decisions for the desktop launcher and Host child. */

import { join } from 'node:path'

/** Environment key carrying the Node executable that launched the Electron shell. */
export const DESKTOP_NODE_EXECUTABLE = 'DSH_DESKTOP_NODE_EXECUTABLE'

/**
 * Environment key opting the Host's windows-acl sandbox runners into their
 * forensic JSONL log. Must match ACL_RUNNER_DEBUG_LOG_ENV in
 * `@deepseek-ai/dsh-sandbox-windows-acl`; the seam reads it in the Host
 * process and forwards it on the runner argv as `--debug-log`.
 */
export const ACL_RUNNER_DEBUG_LOG_ENV = 'DSH_ACL_DEBUG_LOG'

/** Message sent from the Host child after the Web profile is ready. */
export interface DesktopHostReady {
  readonly type: 'ready'
  readonly url: string
}

/** Message sent from the Host child when profile startup fails. */
export interface DesktopHostError {
  readonly type: 'error'
  readonly message: string
}

/** Validated Host-child messages accepted by the Electron main process. */
export type DesktopHostMessage = DesktopHostReady | DesktopHostError

/** WebServer values required to open the desktop renderer. */
export interface DesktopWebServer {
  readonly host: string
  readonly port: number
}

/** Loader entry fields used to find an isolated WebServer provider. */
export interface DesktopLoaderEntry {
  readonly options: { readonly id: string }
  readonly ctx: { get(name: string): unknown }
}

/** Parent request that asks the Host child to dispose the profile. */
export interface DesktopHostShutdown {
  readonly type: 'shutdown'
}

/**
 * Return user arguments from an Electron invocation.
 * @param argv - Complete Electron process argv.
 * @param defaultApp - Whether Electron was launched with an application path.
 * @returns Arguments following the executable and optional application path.
 */
export function desktopArguments(argv: readonly string[], defaultApp: boolean): string[] {
  return argv.slice(defaultApp ? 2 : 1)
}

/**
 * Resolve the directory inherited by the ordinary-Node Host.
 * @param packaged - Whether the Electron application is packaged.
 * @param homeDirectory - The current user's home directory.
 * @param currentDirectory - The launcher's current working directory.
 * @returns The user's home for packaged launches, otherwise the launcher's cwd.
 */
export function resolveDesktopHostCwd(
  packaged: boolean,
  homeDirectory: string,
  currentDirectory: string,
): string {
  return packaged ? homeDirectory : currentDirectory
}

/**
 * Resolve the ordinary Node executable used for the Host child.
 * @param environment - Electron main-process environment.
 * @returns The launcher-provided executable, npm's Node executable, or `node` from PATH.
 */
export function resolveNodeExecutable(environment: NodeJS.ProcessEnv): string {
  for (const key of [DESKTOP_NODE_EXECUTABLE, 'npm_node_execpath']) {
    const candidate = environment[key]?.trim()
    if (candidate !== undefined && candidate !== '') return candidate
  }
  return process.platform === 'win32' ? 'node.exe' : 'node'
}

/**
 * Resolve the ordinary Node executable embedded beside a packaged application.
 * @param resourcesPath - Electron's packaged resources directory.
 * @param platform - Packaged target platform.
 * @returns Absolute path to the ordinary Node sidecar.
 */
export function packagedNodeExecutable(resourcesPath: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') throw new Error(`desktop: packaged Node is unavailable on ${platform}`)
  return join(resourcesPath, 'n', 'node.exe')
}

/**
 * Resolve the Host child embedded beside a packaged application.
 * @param resourcesPath - Electron's packaged resources directory.
 * @returns Absolute path to the ordinary-Node Host entry.
 */
export function packagedHostEntry(resourcesPath: string): string {
  return join(resourcesPath, 'h', 'desktop-host-child.js')
}

/** Paths where the desktop shell persists Host process output. */
export interface DesktopHostLogPaths {
  /** Host stdout log path. */
  readonly stdout: string
  /** Host stderr log path. */
  readonly stderr: string
}

/**
 * Resolve the persistent Host output files below Electron's user data path.
 * @param userDataPath - Electron's per-user application data directory.
 * @returns Separate append-only paths for Host stdout and stderr.
 */
export function desktopHostLogPaths(userDataPath: string): DesktopHostLogPaths {
  const logs = join(userDataPath, 'logs')
  return {
    stdout: join(logs, 'host.stdout.log'),
    stderr: join(logs, 'host.stderr.log'),
  }
}

/**
 * Resolve a reachable loopback URL from the WebServer's bound address.
 * @param host - Bound WebServer host.
 * @param port - Actual listening port.
 * @returns HTTP URL loaded by the Electron renderer.
 */
export function webServerUrl(host: string, port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop host: invalid WebServer port ${String(port)}`)
  }
  const reachable = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host
  const url = new URL('http://127.0.0.1/')
  url.hostname = reachable
  url.port = String(port)
  return url.href
}

/**
 * Find the WebServer service on its Loader entry context.
 * @param entries - Settled Loader entries from the Web profile.
 * @returns The validated bound WebServer values.
 */
export function resolveDesktopWebServer(entries: Iterable<DesktopLoaderEntry>): DesktopWebServer {
  for (const entry of entries) {
    if (entry.options.id !== 'webserver') continue
    const candidate = entry.ctx.get('webServer')
    if (typeof candidate !== 'object' || candidate === null) break
    const { host, port } = candidate as Record<string, unknown>
    if (typeof host === 'string' && host !== '' && Number.isInteger(port) && Number(port) > 0) {
      return { host, port: Number(port) }
    }
    break
  }
  throw new Error('desktop host: settled Web profile has no bound webserver entry')
}

/**
 * Parse one message crossing the Host-child IPC boundary.
 * @param value - Untrusted structured-clone value.
 * @returns A valid desktop Host message, or `undefined`.
 */
export function parseDesktopHostMessage(value: unknown): DesktopHostMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record.type === 'error') {
    return typeof record.message === 'string' && record.message !== ''
      ? { type: 'error', message: record.message }
      : undefined
  }
  if (record.type !== 'ready' || typeof record.url !== 'string') return undefined
  try {
    const url = new URL(record.url)
    const loopback = url.hostname === '127.0.0.1'
      || url.hostname === 'localhost'
      || url.hostname === '[::1]'
    if (url.protocol !== 'http:' || !loopback || url.port === '') return undefined
    return { type: 'ready', url: url.href }
  } catch {
    return undefined
  }
}

/**
 * Decide whether one renderer permission is allowed by the desktop shell.
 * @param permission - Electron's permission name.
 * @param applicationUrl - The URL owned by the Host Web profile.
 * @param requestingUrl - The URL of the frame requesting the permission.
 * @returns Whether the request is the app's clipboard write permission.
 */
export function isDesktopPermissionAllowed(
  permission: string,
  applicationUrl: string,
  requestingUrl: string,
): boolean {
  return permission === 'clipboard-sanitized-write'
    && isApplicationNavigation(applicationUrl, requestingUrl)
}

/**
 * Decide whether a Host exit should be presented as an unexpected stop.
 * @param hostReady - Whether the Host completed startup.
 * @param shutdownStarted - Whether the desktop shell owns an intentional quit.
 * @param code - Child process exit code.
 * @param signal - Signal that terminated the child, if any.
 * @returns Whether the exit is an unexpected runtime failure.
 */
export function isUnexpectedDesktopHostExit(
  hostReady: boolean,
  shutdownStarted: boolean,
  code: number | null,
  signal: NodeJS.Signals | null,
): boolean {
  return hostReady && !shutdownStarted && (code !== 0 || signal !== null)
}

/**
 * Check the only parent-to-child IPC message.
 * @param value - Untrusted structured-clone value.
 * @returns Whether the value requests Host shutdown.
 */
export function isDesktopHostShutdown(value: unknown): value is DesktopHostShutdown {
  if (typeof value !== 'object' || value === null) return false
  return (value as Record<string, unknown>).type === 'shutdown'
}

/**
 * Check whether a navigation stays inside the served application origin.
 * @param applicationUrl - Web profile URL loaded by the shell.
 * @param navigationUrl - Requested renderer navigation.
 * @returns Whether both URLs have the same origin.
 */
export function isApplicationNavigation(applicationUrl: string, navigationUrl: string): boolean {
  try {
    return new URL(applicationUrl).origin === new URL(navigationUrl).origin
  } catch {
    return false
  }
}

/**
 * Check whether a blocked application navigation may open in the system browser.
 * @param url - Requested external URL.
 * @returns Whether the URL uses HTTP or HTTPS.
 */
export function isExternalWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
