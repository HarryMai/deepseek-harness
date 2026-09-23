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
import type {} from '@deepseek-ai/dsh-settings'

/** Profile entry id exposed to the MCP configuration form. */
export const MCP_SETTINGS_NAMESPACE = 'mcp-client'

/** A user-authored MCP record before it is resolved into a client entry. */
export interface McpServerSettings {
  /** Whether this saved server is eligible to load while the collection is enabled. */
  enabled: boolean
  /** Whether this record starts a local process or connects to an HTTP endpoint. */
  transport: 'stdio' | 'streamable-http'
  /** Namespace for the server's model-facing tool names. */
  serverName: string
  /** Executable or runtime command for a stdio server. */
  command: string
  /** Arguments passed directly to a stdio command. */
  args: readonly string[]
  /** Extra environment variables merged into the scrubbed parent environment. */
  env?: Record<string, string>
  /** Working directory for a stdio command. */
  cwd: string
  /** Streamable HTTP endpoint URL. */
  url: string
}

/** Saved user settings that control every dynamic MCP client instance. */
export interface McpSettings {
  /** Whether the manager starts individually enabled, valid MCP records. */
  enabled: boolean
  /** Stable user-record ids mapped to their transport details. */
  servers: Record<string, McpServerSettings>
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

/** Result of resolving one saved settings section into Loader child entries. */
export interface McpClientEntries {
  /** Entries that the owning {@link McpClientSettingsGroup} should activate. */
  entries: EntryOptions[]
  /** Records intentionally omitted while preserving any valid peers. */
  issues: McpSettingsIssue[]
}

/** Resolve the Loader tree owned by this EntryGroup's construction context. */
function requireEntryTree(ctx: Context) {
  const entry = ctx.fiber.entry
  if (entry === undefined) throw new Error('mcp-client settings group requires a Loader entry context')
  return entry.parent.tree
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

/** Schema for the persisted user section. Blank records remain valid while a user fills the form. */
export const McpSettingsConfig = z.object({
  enabled: z.boolean().default(false),
  servers: z.dict(McpServerSettingsConfig).default({}),
})

/** Live profile configuration for the MCP client collection. */
export interface Config {
  /** Whether individually enabled MCP servers may run. */
  enabled: Volatile<boolean>
  /** Saved server records; edits reconcile the active children. */
  servers: Volatile<Record<string, McpServerSettings>>
}

/** Editable profile fields for the MCP collection. */
export const Config = z.object({
  enabled: z.boolean().default(false).volatile(),
  servers: z.dict(McpServerSettingsConfig).default({}).volatile(),
})

/** Default persisted behavior: MCP support is present but entirely inactive. */
export const DEFAULT_MCP_SETTINGS: McpSettings = { enabled: false, servers: {} }

/**
 * Resolve user-entered settings into Loader children without placing credentials
 * or deployment choices in the shipped composition.
 *
 * @param settings - resolved `mcp-client` settings section.
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
 * Loader group that watches the user-owned settings section and transactionally
 * reconciles its mcp-client children. A serial queue prevents overlapping
 * settings commits from interleaving Loader rollback work.
 */
export class McpClientSettingsGroup extends EntryGroup {
  private tail: Promise<void> = Promise.resolve()
  private signature: string | undefined
  private stopped = false

  /**
   * @param ctx - Loader entry context owning this group.
   * @param config - Live profile values controlling the child clients.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, requireEntryTree(ctx))
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    })
    ctx.on('loader/volatile-update', () => { void this.enqueue() })
  }

  /** Start the empty default group and drain every queued reconcile during teardown. */
  async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    await this.enqueue()
    yield async () => {
      this.stopped = true
      await this.tail
      await this.stop()
    }
  }

  /** Queue one source-to-child reconciliation, containing failure to this optional integration. */
  private enqueue(): Promise<void> {
    const task = this.tail.then(async () => {
      if (this.stopped || this.ctx.fiber.uid === null) return
      const resolved = resolveMcpClientEntries({ enabled: this.config.enabled.get(), servers: this.config.servers.get() })
      const signature = JSON.stringify(resolved)
      if (signature === this.signature) return
      if (resolved.issues.length > 0) {
        this.ctx.logger.warn(`mcp-client settings: ignored ${String(resolved.issues.length)} unusable saved MCP server(s)`)
      }
      await this.update(resolved.entries)
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

/** The manager injects the optional Settings service for its custom form policy. */
export const inject: readonly string[] = []

/** Loader callback for the settings-owned dynamic group. */
export const apply = McpClientSettingsGroup
