/**
 * User-owned MCP settings manager. The manager is a Loader group rather than
 * a fixed composition row: an empty, disabled setting starts no MCP process;
 * saved records become independent mcp-client child entries at runtime.
 *
 * @module @deepseek-ai/dsh-mcp-client/settings
 */

import { Service, type Context, type Volatile } from '@deepseek-ai/cordis'
import { EntryGroup, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-loader'

/** Profile entry id used by the MCP settings page. */
export const MCP_SETTINGS_NAMESPACE = 'mcp-client'

/** Loader group containing the dynamically managed MCP client entries. */
export const MCP_SETTINGS_GROUP_ID = 'mcp-settings'

/** A user-authored MCP record before it is resolved into a client entry. */
export interface McpServerSettings {
  /** Whether this saved server is eligible to load while the collection is enabled. */
  readonly enabled: boolean
  /** Whether this record starts a local process or connects to an HTTP endpoint. */
  readonly transport: 'stdio' | 'streamable-http'
  /** Namespace for the server's model-facing tool names. */
  readonly serverName: string
  /** Executable or runtime command for a stdio server. */
  readonly command: string
  /** Arguments passed directly to a stdio command. */
  readonly args: readonly string[]
  /** Extra environment variables merged into the scrubbed parent environment. */
  readonly env?: Readonly<Record<string, string>>
  /** Working directory for a stdio command. */
  readonly cwd: string
  /** Streamable HTTP endpoint URL. */
  readonly url: string
}

/** Saved user settings that control every dynamic MCP client instance. */
export interface McpSettings {
  /** Whether the manager starts individually enabled, valid MCP records. */
  readonly enabled: boolean
  /** Stable user-record ids mapped to their transport details. */
  readonly servers: Readonly<Record<string, McpServerSettings>>
}

/** Why a stored record was not started. */
export type McpSettingsIssueReason = 'incomplete' | 'invalid-server-name' | 'invalid-url' | 'invalid-environment' | 'duplicate-server-name'

/** A stored MCP record that the manager deliberately leaves unloaded. */
export interface McpSettingsIssue {
  /** Stable record id from {@link McpSettings.servers}. */
  id: string
  /** The validation condition that prevents this record from starting. */
  reason: McpSettingsIssueReason
}

/** Result of resolving one profile settings entry into Loader child entries. */
export interface McpClientEntries {
  /** Entries that the owning {@link McpClientSettingsManager} should activate. */
  entries: EntryOptions[]
  /** Records intentionally omitted while preserving any valid peers. */
  issues: McpSettingsIssue[]
}

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const RESERVED_ENV_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** Reject environment entries that Node cannot pass to a child process safely. */
function isValidEnvironment(value: Record<string, string> | undefined): boolean {
  return Object.entries(value ?? {}).every(([key, entry]) => key.length > 0 && !RESERVED_ENV_KEYS.has(key)
    && !/[=\0\r\n]/u.test(key) && !entry.includes('\0'))
}

const McpServerSettingsConfig = z.object({
  enabled: z.boolean().default(false),
  transport: z.union(['stdio', 'streamable-http']).default('stdio'),
  serverName: z.string().default(''),
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  env: z.dict(String).default({}),
  cwd: z.string().default(''),
  url: z.string().default(''),
})

/** Schema for the profile-backed settings page. Blank records remain valid while a user fills the form. */
export const McpSettingsConfig = z.object({
  enabled: z.boolean().default(false).volatile(),
  servers: z.dict(McpServerSettingsConfig).default({}).volatile(),
})

/** Default persisted behavior: MCP support is present but entirely inactive. */
export const DEFAULT_MCP_SETTINGS: McpSettings = { enabled: false, servers: {} }

/** Live profile values projected into the MCP settings manager. */
export interface McpClientSettingsConfig {
  /** Whether individually enabled, valid server records may start. */
  enabled: Volatile<boolean>
  /** Stable user-record ids mapped to their transport details. */
  servers: Volatile<Record<string, McpServerSettings>>
}

/**
 * Resolve user-entered settings into Loader children without placing credentials
 * or deployment choices in the shipped composition.
 *
 * @param settings - current `mcp-client` profile values.
 * @returns valid child entries plus records intentionally not loaded.
 */
export function resolveMcpClientEntries(settings: McpSettings): McpClientEntries {
  if (!settings.enabled) return { entries: [], issues: [] }

  const entries: EntryOptions[] = []
  const issues: McpSettingsIssue[] = []
  const names = new Set<string>()
  // Object property order is the user-record order. Keeping it lets the
  // earliest saved record retain its namespace when a manually edited file
  // temporarily contains a duplicate; issues below are sorted only for stable
  // diagnostics.
  for (const [id, server] of Object.entries(settings.servers)) {
    if (!server.enabled) continue
    const serverName = server.serverName.trim()
    if (serverName.length === 0) {
      issues.push({ id, reason: 'incomplete' })
      continue
    }
    if (!SERVER_NAME_PATTERN.test(serverName)) {
      issues.push({ id, reason: 'invalid-server-name' })
      continue
    }
    if (names.has(serverName)) {
      issues.push({ id, reason: 'duplicate-server-name' })
      continue
    }

    if (server.transport === 'stdio') {
      const command = server.command.trim()
      if (command.length === 0) {
        issues.push({ id, reason: 'incomplete' })
        continue
      }
      if (!isValidEnvironment(server.env)) {
        issues.push({ id, reason: 'invalid-environment' })
        continue
      }
      names.add(serverName)
      entries.push({
        id: `mcp-${encodeURIComponent(id)}`,
        name: '@deepseek-ai/dsh-mcp-client',
        config: {
          transport: 'stdio',
          serverName,
          command,
          args: [...server.args],
          env: { ...server.env },
          cwd: server.cwd.trim(),
          // A saved user record must not prevent the rest of the application
          // from starting if its server is temporarily unavailable.
          failOnStartupError: false,
        },
      })
      continue
    }

    const url = server.url.trim()
    if (url.length === 0) {
      issues.push({ id, reason: 'incomplete' })
      continue
    }
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        issues.push({ id, reason: 'invalid-url' })
        continue
      }
    } catch {
      issues.push({ id, reason: 'invalid-url' })
      continue
    }
    names.add(serverName)
    entries.push({
      id: `mcp-${encodeURIComponent(id)}`,
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        transport: 'streamable-http',
        serverName,
        url,
        // A saved user record must not prevent the rest of the application
        // from starting if its endpoint is temporarily unavailable.
        failOnStartupError: false,
      },
    })
  }
  issues.sort((left, right) => left.id.localeCompare(right.id))
  return { entries, issues }
}

/**
 * Profile-backed settings owner that reconciles MCP client entries in the
 * separate `mcp-settings` group. A serial queue prevents overlapping volatile
 * updates from interleaving Loader rollback work.
 */
export class McpClientSettingsManager extends Service {
  static Config = McpSettingsConfig

  private group: EntryGroup | undefined
  private tail: Promise<void> = Promise.resolve()
  private signature: string | undefined
  private stopped = false

  /**
   * @param ctx - Loader entry context owning the profile settings.
   * @param config - Volatile values edited by the MCP settings page.
   */
  constructor(ctx: Context, private readonly config: McpClientSettingsConfig) {
    super(ctx, 'mcpClientSettings')
    ctx.on('loader/volatile-update', () => { void this.enqueue() })
  }

  /** Reconcile the initial profile values and clear managed clients during teardown. */
  async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    const entry = this.ctx.loader.resolve(MCP_SETTINGS_GROUP_ID)
    await entry._initTask
    await entry.fiber?.await()
    this.group = entry.subgroup
    if (this.group === undefined) throw new Error(`MCP settings group ${MCP_SETTINGS_GROUP_ID} did not activate`)
    await this.enqueue()
    yield async () => {
      this.stopped = true
      await this.tail
      const group = this.group
      if (group !== undefined) await group.update([])
    }
  }

  /** Queue one source-to-child reconciliation, containing failure to this optional integration. */
  private enqueue(): Promise<void> {
    const task = this.tail.then(async () => {
      const group = this.group
      if (this.stopped || this.ctx.fiber.uid === null || group === undefined) return
      const resolved = resolveMcpClientEntries({
        enabled: this.config.enabled.get(),
        servers: this.config.servers.get(),
      })
      const signature = JSON.stringify(resolved)
      if (signature === this.signature) return
      if (resolved.issues.length > 0) {
        this.ctx.logger.warn(`mcp-client settings: ignored ${String(resolved.issues.length)} unusable saved MCP server(s)`)
      }
      await group.update(resolved.entries)
      this.signature = signature
    })
    this.tail = task.catch((error: unknown) => {
      if (this.stopped || this.ctx.fiber.uid === null) return
      this.ctx.logger.warn('mcp-client settings: could not apply saved MCP servers')
      this.ctx.logger.warn(error)
    })
    return this.tail
  }
}

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'mcp-client-settings'

/** Profile-backed Config schema read by Loader and Settings forms. */
export const Config = McpSettingsConfig

/** The manager resolves its dedicated child group from the active Loader tree. */
export const inject = ['loader']

/** Profile-backed settings manager for dynamic user-owned MCP client entries. */
export const apply = McpClientSettingsManager
