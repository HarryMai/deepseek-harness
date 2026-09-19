/**
 * One-shot MCP connection probe for the Custom Configuration settings page.
 *
 * The probe deliberately does not reuse the long-lived client supervisor: a
 * settings-page test must not register tools, persist a record, or start a
 * reconnect loop. It creates one client, completes MCP initialization and a
 * `tools/list`, then closes the transport before returning the result.
 *
 * @module @deepseek-ai/dsh-mcp-client/probe
 */

import { Client } from '@modelcontextprotocol/client'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS, deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
// Side-effect type import: declaration-merges the Host `ctx.connection` service.
import type {} from '@deepseek-ai/dsh-client-connection'
import { createTransport } from './transport.ts'
import type { Config as McpClientConfig } from './index.ts'
import type { McpServerSettings } from './settings.ts'

/** Dedicated, loopback-only Connection RPC channel for the MCP settings page. */
export const MCP_SETTINGS_RPC_CHANNEL = '/mcp-settings'

/** Endpoint that verifies one staged MCP record without saving or enabling it. */
export const MCP_SETTINGS_TEST_ENDPOINT = 'test'

/** Default deadline covering connection initialization and tool discovery. */
export const DEFAULT_MCP_CONNECTION_TEST_TIMEOUT_MS = 10_000

const TEST_TIMEOUT_CODE = 'MCP_CONNECTION_TEST_TIMEOUT'
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const RESERVED_ENV_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const SERVER_FIELDS = new Set([
  'enabled', 'transport', 'serverName', 'command', 'args', 'env', 'cwd', 'url',
])

/** Host plugin configuration for a settings-page probe. */
export interface McpConnectionProbeConfig {
  /** Maximum time spent connecting and listing tools for one test request. */
  timeoutMs?: number
}

/** Result displayed by the settings page after a one-shot MCP connection test. */
export type McpConnectionTestResult =
  | { ok: true; toolCount: number }
  | { ok: false; reason: McpConnectionTestFailure }

/** Stable result categories safe to send to the browser without server details. */
export type McpConnectionTestFailure =
  | 'invalid-configuration'
  | 'connection-failed'
  | 'timed-out'
  | 'cancelled'
  | 'unavailable'

/** Loader schema for the bounded connection-test timeout. */
export const Config: z<McpConnectionProbeConfig> = z.object({
  timeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_MCP_CONNECTION_TEST_TIMEOUT_MS),
})

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'mcp-client-probe'

/** Connection becomes available after the web transport plugin starts. */
export const inject: readonly string[] = []

/**
 * Register the settings test endpoint when the Host Connection service is available.
 *
 * @param ctx - plugin context that owns the route lifetime.
 * @param config - configured deadline for a single probe.
 */
export function apply(ctx: Context, config: McpConnectionProbeConfig): void {
  const timeoutMs = config.timeoutMs ?? DEFAULT_MCP_CONNECTION_TEST_TIMEOUT_MS
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      MCP_SETTINGS_RPC_CHANNEL,
      async (endpoint, payload, signal) => {
        if (endpoint !== MCP_SETTINGS_TEST_ENDPOINT) return { ok: true, value: { ok: false, reason: 'unavailable' } }
        return { ok: true, value: await probeMcpConnection(payload, signal, timeoutMs) }
      },
    )
  })
}

/**
 * Connect a temporary MCP client and list every advertised tool.
 *
 * @param payload - untrusted request body from the settings page.
 * @param upstream - caller cancellation propagated by the Connection route.
 * @param timeoutMs - positive deadline covering the entire probe.
 * @returns a browser-safe outcome that does not reveal command, endpoint, or credentials.
 */
export async function probeMcpConnection(
  payload: unknown,
  upstream: AbortSignal | undefined,
  timeoutMs = DEFAULT_MCP_CONNECTION_TEST_TIMEOUT_MS,
): Promise<McpConnectionTestResult> {
  const config = testConfigFromPayload(payload, timeoutMs)
  if (config === undefined) return { ok: false, reason: 'invalid-configuration' }

  const client = new Client(
    { name: 'dsh-mcp-settings-probe', version: '0.0.1' },
    { capabilities: {} },
  )
  using testDeadline = deadline(upstream, timeoutMs, TEST_TIMEOUT_CODE)
  try {
    await awaitWithSignal(() => client.connect(createTransport(config)), testDeadline.signal)
    return { ok: true, toolCount: await listToolCount(client, testDeadline.signal) }
  } catch {
    if (timeoutOf(testDeadline.signal, TEST_TIMEOUT_CODE) !== undefined) return { ok: false, reason: 'timed-out' }
    if (testDeadline.signal.aborted) return { ok: false, reason: 'cancelled' }
    return { ok: false, reason: 'connection-failed' }
  } finally {
    try {
      await client.close()
    } catch {
      // A failed initialization can close the transport before the client owns it.
    }
  }
}

/**
 * Decode the browser payload into the full client configuration required by the MCP SDK.
 *
 * User settings retain stdio environment variables as a string map. HTTP headers
 * remain unavailable because the settings page has no editable header fields.
 */
function testConfigFromPayload(payload: unknown, timeoutMs: number): McpClientConfig | undefined {
  if (!isPlainObject(payload) || !isPlainObject(payload.server)) return undefined
  const server = parseServer(payload.server)
  if (server === undefined) return undefined
  if (server.transport === 'stdio') {
    return {
      transport: 'stdio',
      serverName: server.serverName,
      command: server.command,
      args: server.args,
      env: { ...server.env },
      cwd: server.cwd,
      toolCallTimeoutMs: timeoutMs,
      failOnStartupError: true,
      reconnect: { enabled: false },
    }
  }
  return {
    transport: 'streamable-http',
    serverName: server.serverName,
    url: server.url,
    headers: {},
    toolCallTimeoutMs: timeoutMs,
    failOnStartupError: true,
    reconnect: { enabled: false },
  }
}

/** Decode one exact persisted-record representation at the Host trust boundary. */
function parseServer(value: Record<string, unknown>): McpServerSettings | undefined {
  if (Object.keys(value).some(key => !SERVER_FIELDS.has(key))) return undefined
  if (typeof value.enabled !== 'boolean'
    || (value.transport !== 'stdio' && value.transport !== 'streamable-http')
    || typeof value.serverName !== 'string'
    || typeof value.command !== 'string'
    || !Array.isArray(value.args)
    || !value.args.every(arg => typeof arg === 'string')
    || typeof value.cwd !== 'string'
    || typeof value.url !== 'string') return undefined

  const serverName = value.serverName.trim()
  if (!SERVER_NAME_PATTERN.test(serverName)) return undefined
  const env = parseEnvironment(value.env)
  if (env === undefined) return undefined
  const server: McpServerSettings = {
    enabled: value.enabled,
    transport: value.transport,
    serverName,
    command: value.command.trim(),
    args: [...value.args],
    env,
    cwd: value.cwd.trim(),
    url: value.url.trim(),
  }
  if ([server.command, server.cwd, ...server.args].some(field => field.includes('\0'))) return undefined
  if (server.transport === 'stdio') return server.command.length > 0 ? server : undefined
  if (server.url.length === 0) return undefined
  try {
    const url = new URL(server.url)
    return url.protocol === 'http:' || url.protocol === 'https:' ? server : undefined
  } catch {
    return undefined
  }
}

/** Await an SDK operation while making a non-abort-aware transport observe cancellation. */
function awaitWithSignal<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    let operation: Promise<T>
    try {
      operation = start()
    } catch (error) {
      signal.removeEventListener('abort', abort)
      reject(error)
      return
    }
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

/** List every MCP tool without installing it into the harness registry. */
async function listToolCount(client: Client, signal: AbortSignal): Promise<number> {
  const result = await awaitWithSignal(
    () => client.listTools(undefined, { signal, cacheMode: 'refresh' }),
    signal,
  )
  return result.tools.length
}

/** Narrow JSON-like input without consulting inherited properties. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

/** Validate one environment variable key accepted by a child-process env map. */
function isEnvironmentKey(value: string): boolean {
  return value.length > 0 && !RESERVED_ENV_KEYS.has(value) && !/[=\0\r\n]/u.test(value)
}

/** Decode the optional stdio environment map without accepting inherited properties. */
function parseEnvironment(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return {}
  if (!isPlainObject(value)) return undefined
  const entries = Object.entries(value)
  const environment: Record<string, string> = {}
  for (const [key, entry] of entries) {
    if (!isEnvironmentKey(key) || typeof entry !== 'string' || entry.includes('\0')) return undefined
    environment[key] = entry
  }
  return environment
}
