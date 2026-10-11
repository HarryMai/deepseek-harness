/**
 * User-owned MCP settings manager. Starts isolated mcp-client instances for
 * each session based on user configuration and session project directory.
 *
 * @module @deepseek-ai/dsh-mcp-client/settings
 */

import { Service, type Context, type Fiber, type Volatile } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-settings'
import * as McpClient from './index.ts'

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
export type McpSettingsIssueReason = 'incomplete' | 'invalid-server-name' | 'invalid-url' | 'invalid-environment' | 'duplicate-server-name' | 'missing-cwd'

/** A stored MCP record that the manager deliberately leaves unloaded. */
export interface McpSettingsIssue {
  /** Stable record id from {@link McpSettings.servers}. */
  id: string
  /** The validation condition that prevents this record from starting. */
  reason: McpSettingsIssueReason
}

/** Result of resolving one saved settings section into child entries. */
export interface McpClientEntries {
  /** Entries that the owning {@link McpClientSettingsGroup} should activate. */
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
 * Resolve user-entered settings into client entries without placing credentials
 * or deployment choices in the shipped composition.
 *
 * @param settings - resolved `mcp-client` settings section.
 * @param sessionCwd - optional project working directory for the active session.
 * @returns valid child entries plus records intentionally not loaded.
 */
export function resolveMcpClientEntries(settings: McpSettings, sessionCwd?: string): McpClientEntries {
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
      const effectiveCwd = sessionCwd?.trim() || server.cwd.trim()
      if (effectiveCwd.length === 0) {
        issues.push({ id, reason: 'missing-cwd' })
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
          cwd: effectiveCwd,
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

/** Tracked live client fiber on one agent. */
interface LiveClientInstance {
  readonly signature: string
  readonly fiber: Fiber
}

/**
 * Settings manager that watches user-owned MCP settings and starts isolated
 * MCP client instances for each session. A serial queue prevents overlapping
 * settings commits from interleaving reconciliation work.
 */
export class McpClientSettingsGroup {
  private tail: Promise<void> = Promise.resolve()
  private stopped = false
  private clientPlugin: unknown
  private readonly liveAgents = new Map<Agent, Map<string, LiveClientInstance>>()

  /**
   * @param ctx - plugin context owning this settings manager.
   * @param config - Live profile values controlling the child clients.
   */
  constructor(private readonly ctx: Context, private readonly config: Config) {
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    })
    ctx.on('agent/created', async ({ agent }) => {
      await this.reconcileAgent(agent)
    })
    ctx.on('agent/disposed', ({ agent }) => {
      this.dropAgent(agent)
    })
    ctx.on('loader/volatile-update', () => { void this.enqueue() })
  }

  /** Start the manager and drain every queued reconcile during teardown. */
  async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    await this.enqueue()
    yield async () => {
      this.stopped = true
      await this.tail
      for (const [, instances] of this.liveAgents) {
        for (const instance of instances.values()) {
          await Promise.resolve(instance.fiber.dispose())
        }
      }
      this.liveAgents.clear()
    }
  }

  /** Resolve the client plugin implementation, preferring loader interception when present. */
  private async resolveClientPlugin(): Promise<unknown> {
    if (this.clientPlugin !== undefined) return this.clientPlugin
    if (this.ctx.loader?.internal?.import) {
      try {
        const resolved = await this.ctx.loader.internal.import(
          '@deepseek-ai/dsh-mcp-client',
          this.ctx.baseUrl ?? '',
          {},
        )
        if (resolved) {
          this.clientPlugin = resolved
          return resolved
        }
      } catch {
        // Fall back to direct module when loader cannot resolve the specifier.
      }
    }
    this.clientPlugin = McpClient
    return McpClient
  }

  /** Collect all agents eligible for reconciliation. */
  private collectLiveAgents(): Agent[] {
    const fromRegistry = this.ctx.get('agents')?.list() ?? []
    const fromLive = [...this.liveAgents.keys()]
    const all = new Set([...fromRegistry, ...fromLive])
    return [...all]
  }

  /** Reconcile MCP client instances for a single live agent session. */
  private async reconcileAgent(agent: Agent): Promise<void> {
    if (this.stopped || this.ctx.fiber.uid === null) return
    const settings: McpSettings = {
      enabled: this.config.enabled.get(),
      servers: this.config.servers.get(),
    }
    const sessionCwd = agent.session.header.cwd
    const resolved = resolveMcpClientEntries(settings, sessionCwd)
    if (resolved.issues.length > 0) {
      this.ctx.logger.warn(`mcp-client settings: ignored ${String(resolved.issues.length)} unusable saved MCP server(s) for session ${agent.id}`)
    }

    let serverInstances = this.liveAgents.get(agent)
    if (!serverInstances) {
      serverInstances = new Map<string, LiveClientInstance>()
      this.liveAgents.set(agent, serverInstances)
    }

    const nextEntries = new Map<string, EntryOptions>()
    for (const entry of resolved.entries) {
      nextEntries.set(entry.id!, entry)
    }

    for (const [id, instance] of [...serverInstances.entries()]) {
      const nextEntry = nextEntries.get(id)
      const nextSignature = nextEntry ? JSON.stringify(nextEntry.config) : undefined
      if (nextSignature !== instance.signature) {
        await Promise.resolve(instance.fiber.dispose())
        serverInstances.delete(id)
      }
    }

    const plugin = await this.resolveClientPlugin()
    for (const [id, nextEntry] of nextEntries.entries()) {
      if (serverInstances.has(id)) continue
      const nextSignature = JSON.stringify(nextEntry.config)
      try {
        const fiber = await agent.ctx.plugin(plugin as never, nextEntry.config as never)
        serverInstances.set(id, { signature: nextSignature, fiber })
      } catch (error: unknown) {
        this.ctx.logger.warn(`mcp-client settings: could not mount ${id} on session ${agent.id}`)
        this.ctx.logger.warn(error)
      }
    }
  }

  /** Drop all tracking and dispose fibers for an exited agent. */
  private dropAgent(agent: Agent): void {
    const instances = this.liveAgents.get(agent)
    if (instances) {
      this.liveAgents.delete(agent)
      for (const instance of instances.values()) {
        void Promise.resolve(instance.fiber.dispose())
      }
    }
  }

  /** Queue reconciliation across all live sessions, containing failure to this optional integration. */
  private enqueue(): Promise<void> {
    const task = this.tail.then(async () => {
      if (this.stopped || this.ctx.fiber.uid === null) return
      const agents = this.collectLiveAgents()
      for (const agent of agents) {
        await this.reconcileAgent(agent)
      }
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
