/**
 * Browser-side staged editor for the Host-owned `mcp-client` settings section.
 * The browser never starts a process itself; it only saves the user collection
 * that the Host settings manager reconciles into MCP client entries.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/** The Host settings namespace this UI edits. Kept literal to avoid a client-to-host value dependency. */
export const MCP_SETTINGS_NAMESPACE = 'mcp-client'

/** One browser-editable MCP server record. */
export interface McpServerSettings {
  /** Whether this saved service loads while the master switch is enabled. */
  enabled: boolean
  /** Whether the record launches a local program or connects to Streamable HTTP. */
  transport: 'stdio' | 'streamable-http'
  /** Namespace used in the resulting MCP tool names. */
  serverName: string
  /** Executable or runtime command for stdio servers. */
  command: string
  /** One command argument per item. */
  args: string[]
  /** Extra environment variables merged into the child process environment. */
  env?: Record<string, string>
  /** Optional working directory for a local command. */
  cwd: string
  /** Streamable HTTP endpoint. */
  url: string
}

/** Browser-safe result category for a temporary MCP connection test. */
export type McpConnectionTestFailure =
  | 'invalid-configuration'
  | 'connection-failed'
  | 'timed-out'
  | 'cancelled'
  | 'unavailable'

/** Transient result for one staged MCP record. It is never persisted. */
export type McpConnectionTestState =
  | { status: 'testing' }
  | { status: 'success'; toolCount: number }
  | { status: 'failure'; reason: McpConnectionTestFailure }

/** Host-side adapter for checking one staged record without saving or enabling it. */
export interface McpConnectionTester {
  /** Test one record and return only browser-safe connection information. */
  test(server: McpServerSettings, signal: AbortSignal): Promise<McpConnectionTestResult>
}

/** Wire result returned by {@link McpConnectionTester}. */
export type McpConnectionTestResult =
  | { ok: true; toolCount: number }
  | { ok: false; reason: McpConnectionTestFailure }

/** Why pasted JSON was not added to the staged collection. */
export type McpJsonImportFailure = 'invalid-json' | 'invalid-root' | 'invalid-server' | 'unsupported-fields'

/** Outcome exposed after a JSON paste is added to the staged collection. */
export type McpJsonImportResult =
  | { ok: true; count: number }
  | { ok: false; reason: McpJsonImportFailure }

/** A fully validated record parsed from one pasted MCP JSON document. */
export interface ParsedMcpServer {
  /** Suggested stable local record id; the controller resolves collisions. */
  idHint: string
  /** Complete settings record, always forced off until the user enables it. */
  server: McpServerSettings
}

/** Internal parse result retaining the records that an import will append. */
export type McpJsonParseResult =
  | { ok: true; records: ParsedMcpServer[] }
  | { ok: false; reason: McpJsonImportFailure }

/** The complete collection persisted under the Host MCP settings namespace. */
export interface McpSettings {
  /** Master switch; only individually enabled, complete records are loaded by the Host. */
  enabled: boolean
  /** Stable record ids paired with their editable transport fields. */
  servers: Record<string, McpServerSettings>
}

/** Default collection shown before the Host settings document has an MCP section. */
export const DEFAULT_MCP_SETTINGS: McpSettings = { enabled: false, servers: {} }

/** Why a record will not be loaded when the master switch is enabled. */
export type McpServerIssue = 'disabled' | 'incomplete' | 'invalid-server-name' | 'invalid-url' | 'invalid-environment' | 'duplicate-server-name'

/** Browser state rendered by the Custom Configuration settings section. */
export interface McpSettingsState {
  /** Configuration-form availability state from the Host mirror. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Whether this browser can persist settings to the Host. */
  writable: boolean
  /** Current staged collection, including unsaved edits. */
  settings: McpSettings
  /** Whether the staged collection differs from the last Host value. */
  dirty: boolean
  /** Whether a save sequence is currently crossing the wire. */
  saving: boolean
  /** Whether the last save did not land exactly as staged. */
  failed: boolean
  /** Non-persistent connection-test result keyed by staged record id. */
  tests: Readonly<Record<string, McpConnectionTestState>>
}

/** Slot-injected editor actions and snapshot store. */
export interface McpSettingsFace {
  /** Snapshot consumed by the renderer as `useMcpSettings`. */
  hooks: {
    /** Current Host state plus local draft. */
    mcpSettings: SnapshotStore<McpSettingsState>
  }
  /** Stage the master MCP switch. */
  setEnabled: (enabled: boolean) => void
  /** Add one blank stdio record. */
  addServer: () => void
  /** Append disabled records parsed from one pasted JSON document. */
  importJson: (text: string) => McpJsonImportResult
  /** Remove one staged record. */
  removeServer: (id: string) => void
  /** Replace selected fields of one staged record. */
  editServer: (id: string, patch: Partial<McpServerSettings>) => void
  /** Temporarily connect and list tools for one staged record. */
  testServer: (id: string) => void
  /** Persist the staged collection. */
  save: () => void
  /** Drop staged edits and re-read the last accepted collection. */
  discard: () => void
}

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const RESERVED_RECORD_IDS = new Set(['__proto__', 'constructor', 'prototype'])
const RESERVED_ENV_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const IMPORT_ROOT_KEYS = ['mcpServers', 'mcp_servers', 'servers'] as const
const IMPORT_SERVER_KEYS = new Set([
  'transport', 'type', 'serverName', 'name', 'id', 'command', 'args', 'env', 'cwd', 'url', 'enabled',
])
const UNSUPPORTED_IMPORT_SERVER_KEYS = new Set(['headers'])

const unavailableConnectionTester: McpConnectionTester = {
  async test(): Promise<McpConnectionTestResult> {
    return { ok: false, reason: 'unavailable' }
  },
}

/** Make an independent record copy before it leaves the controller. */
function cloneServer(server: McpServerSettings): McpServerSettings {
  return { ...server, args: [...server.args], env: { ...(server.env ?? {}) } }
}

/** Make an independent copy before a local draft receives edits. */
function cloneSettings(value: McpSettings): McpSettings {
  return {
    enabled: value.enabled,
    servers: Object.fromEntries(Object.entries(value.servers).map(([id, server]) => [id, cloneServer(server)])),
  }
}

/** Normalize an unavailable or older value to fields that this section can edit. */
function normalizeSettings(value: McpSettings | undefined): McpSettings {
  if (value === undefined) return cloneSettings(DEFAULT_MCP_SETTINGS)
  return {
    enabled: value.enabled === true,
    servers: Object.fromEntries(Object.entries(value.servers ?? {}).map(([id, server]) => [id, {
      enabled: server.enabled === true,
      transport: server.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
      serverName: typeof server.serverName === 'string' ? server.serverName : '',
      command: typeof server.command === 'string' ? server.command : '',
      args: Array.isArray(server.args) ? server.args.filter((arg): arg is string => typeof arg === 'string') : [],
      env: normalizeEnvironment(server.env),
      cwd: typeof server.cwd === 'string' ? server.cwd : '',
      url: typeof server.url === 'string' ? server.url : '',
    }])),
  }
}

/** Structural comparison for the JSON-compatible collection this editor owns. */
function sameSettings(left: McpSettings, right: McpSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Identify a record condition the Host manager will leave unloaded.
 *
 * @param server - staged server fields.
 * @param duplicateServerName - whether another staged record uses the same valid name.
 * @returns the reason, or undefined when this record is ready to load.
 */
export function serverIssue(server: McpServerSettings, duplicateServerName = false): McpServerIssue | undefined {
  if (!server.enabled) return 'disabled'
  const serverName = server.serverName.trim()
  if (serverName.length === 0) return 'incomplete'
  if (!SERVER_NAME_PATTERN.test(serverName)) return 'invalid-server-name'
  if (duplicateServerName) return 'duplicate-server-name'
  if (server.transport === 'stdio') {
    if (!isValidEnvironment(server.env)) return 'invalid-environment'
    return server.command.trim().length === 0 ? 'incomplete' : undefined
  }
  const url = server.url.trim()
  if (url.length === 0) return 'incomplete'
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? undefined : 'invalid-url'
  } catch {
    return 'invalid-url'
  }
}

/**
 * Convert line-oriented argument input into exact command arguments.
 *
 * @param text - one argument per line.
 * @returns non-empty lines in their original order.
 */
export function argumentsFromText(text: string): string[] {
  return text.split(/\r?\n/u).filter(line => line.length > 0)
}

/**
 * Parse common MCP JSON formats without modifying the current draft.
 *
 * Accepted documents use `mcpServers`, `mcp_servers`, or `servers` as their
 * service map. A single service record and a bare map of service records are
 * also accepted for convenient copy-and-paste. Environment variables are
 * retained as a string map; HTTP headers remain unsupported by this settings
 * surface because the HTTP transport has no editable header fields.
 *
 * @param text - JSON copied from an MCP configuration document.
 * @returns normalized, disabled records or a user-facing parse category.
 */
export function parseMcpJson(text: string): McpJsonParseResult {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (!isPlainObject(value)) return { ok: false, reason: 'invalid-root' }

  const rootKeys = IMPORT_ROOT_KEYS.filter(key => Object.hasOwn(value, key))
  if (rootKeys.length > 1) return { ok: false, reason: 'invalid-root' }
  if (rootKeys.length === 1) {
    const [rootKey] = rootKeys
    if (rootKey === undefined) return { ok: false, reason: 'invalid-root' }
    const records = value[rootKey]
    return parseMcpServerMap(records)
  }
  if (looksLikeMcpServer(value)) return parseMcpServer(value, '')
  return parseMcpServerMap(value)
}

/** Parse one named MCP service map while preserving its authored order. */
function parseMcpServerMap(value: unknown): McpJsonParseResult {
  if (!isPlainObject(value)) return { ok: false, reason: 'invalid-root' }
  const records: ParsedMcpServer[] = []
  for (const [idHint, candidate] of Object.entries(value)) {
    if (!isSafeRecordId(idHint) || !isPlainObject(candidate)) return { ok: false, reason: 'invalid-server' }
    const parsed = parseMcpServer(candidate, idHint)
    if (!parsed.ok) return parsed
    records.push(...parsed.records)
  }
  return { ok: true, records }
}

/** Parse one MCP server object from a named map or direct-record document. */
function parseMcpServer(value: Record<string, unknown>, fallbackId: string): McpJsonParseResult {
  if (Object.keys(value).some(key => UNSUPPORTED_IMPORT_SERVER_KEYS.has(key))) {
    return { ok: false, reason: 'unsupported-fields' }
  }
  if (Object.keys(value).some(key => !IMPORT_SERVER_KEYS.has(key))) return { ok: false, reason: 'invalid-server' }
  if ((value.enabled !== undefined && typeof value.enabled !== 'boolean')
    || (value.command !== undefined && typeof value.command !== 'string')
    || (value.cwd !== undefined && typeof value.cwd !== 'string')
    || (value.url !== undefined && typeof value.url !== 'string')
    || (value.serverName !== undefined && typeof value.serverName !== 'string')
    || (value.name !== undefined && typeof value.name !== 'string')
    || (value.id !== undefined && typeof value.id !== 'string')
    || (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every(arg => typeof arg === 'string')))) {
    return { ok: false, reason: 'invalid-server' }
  }

  const env = value.env === undefined ? {} : parseEnvironment(value.env)
  if (env === undefined) return { ok: false, reason: 'invalid-server' }

  const transport = parseTransport(value.transport, value.type, value.command, value.url)
  if (transport === undefined) return { ok: false, reason: 'invalid-server' }
  const serverName = firstNonEmpty(value.serverName, value.name, fallbackId)
  if (serverName === undefined || !SERVER_NAME_PATTERN.test(serverName)) return { ok: false, reason: 'invalid-server' }
  const command = typeof value.command === 'string' ? value.command.trim() : ''
  const cwd = typeof value.cwd === 'string' ? value.cwd.trim() : ''
  const url = typeof value.url === 'string' ? value.url.trim() : ''
  const args = Array.isArray(value.args) ? [...value.args] as string[] : []
  if ([command, cwd, ...args].some(field => field.includes('\0'))) return { ok: false, reason: 'invalid-server' }
  if (transport === 'stdio' && command.length === 0) return { ok: false, reason: 'invalid-server' }
  if (transport === 'streamable-http' && !isHttpUrl(url)) return { ok: false, reason: 'invalid-server' }

  const idHint = firstNonEmpty(value.id, fallbackId, serverName) ?? serverName
  if (!isSafeRecordId(idHint)) return { ok: false, reason: 'invalid-server' }
  return {
    ok: true,
    records: [{
      idHint,
      server: {
        // Imported configurations must never gain either level of enablement.
        enabled: false,
        transport,
        serverName,
        command,
        args,
        env,
        cwd,
        url,
      },
    }],
  }
}

/** Resolve explicit transport aliases or infer a transport from one populated endpoint field. */
function parseTransport(
  transport: unknown,
  type: unknown,
  command: unknown,
  url: unknown,
): McpServerSettings['transport'] | undefined {
  const explicit = [transport, type].filter(value => value !== undefined)
  if (explicit.some(value => typeof value !== 'string')) return undefined
  const normalized = explicit.map(value => value === 'http' ? 'streamable-http' : value)
  if (normalized.some(value => value !== 'stdio' && value !== 'streamable-http')
    || new Set(normalized).size > 1) return undefined
  if (normalized.length === 1) return normalized[0] as McpServerSettings['transport']
  const hasCommand = typeof command === 'string' && command.trim().length > 0
  const hasUrl = typeof url === 'string' && url.trim().length > 0
  if (hasCommand === hasUrl) return undefined
  return hasCommand ? 'stdio' : 'streamable-http'
}

/** Return the first non-empty string from authored aliases and fallbacks. */
function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
}

/** Identify a direct server record before treating the root as a record map. */
function looksLikeMcpServer(value: Record<string, unknown>): boolean {
  return Object.keys(value).some(key => IMPORT_SERVER_KEYS.has(key) || UNSUPPORTED_IMPORT_SERVER_KEYS.has(key))
}

/** Keep dangerous object-property names out of both JSON maps and staged ids. */
function isSafeRecordId(value: string): boolean {
  return !RESERVED_RECORD_IDS.has(value) && RECORD_ID_PATTERN.test(value)
}

/** Validate one environment variable key accepted by a child-process env map. */
function isEnvironmentKey(value: string): boolean {
  return value.length > 0 && !RESERVED_ENV_KEYS.has(value) && !/[=\0\r\n]/u.test(value)
}

/** Parse user-authored environment variables without accepting inherited object properties. */
function parseEnvironment(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined
  const entries = Object.entries(value)
  const environment: Record<string, string> = {}
  for (const [key, entry] of entries) {
    if (!isEnvironmentKey(key) || typeof entry !== 'string' || entry.includes('\0')) return undefined
    environment[key] = entry
  }
  return environment
}

/** Normalize an older or malformed settings value before it reaches the editor. */
function normalizeEnvironment(value: unknown): Record<string, string> {
  return parseEnvironment(value) ?? {}
}

/** Check an already typed environment map before it is sent to the Host. */
function isValidEnvironment(value: Record<string, string> | undefined): boolean {
  return Object.entries(value ?? {}).every(([key, entry]) => isEnvironmentKey(key) && !entry.includes('\0'))
}

/** Validate the HTTP-only endpoint form the saved settings manager supports. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Narrow parsed JSON values to ordinary objects with no array prototype behavior. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

/**
 * Stages MCP settings over one shared configuration form and serializes the two fields
 * in an order that prevents accidental transient starts: save records before
 * enabling, and disable before replacing records.
 */
export class McpSettingsController {
  /** Snapshot bound into the slot renderer. */
  readonly store: SnapshotStore<McpSettingsState>

  private committed = cloneSettings(DEFAULT_MCP_SETTINGS)
  private draft = cloneSettings(DEFAULT_MCP_SETTINGS)
  private dirty = false
  private saving = false
  private failed = false
  private nextId = 0
  private readonly tests = new Map<string, McpConnectionTestState>()
  private readonly testControllers = new Map<string, AbortController>()
  private readonly unsubscribe: () => void

  /**
   * @param form - shared settings form owned by ui-settings.
   * @param tester - Host adapter for one-shot connection tests.
   */
  constructor(
    private readonly form: ConfigForm<McpSettings>,
    private readonly tester: McpConnectionTester = unavailableConnectionTester,
  ) {
    this.store = createSnapshotStore(this.project())
    this.unsubscribe = form.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /** Stop the form subscription when this section's client fiber leaves. */
  dispose(): void {
    this.cancelAllTests()
    this.unsubscribe()
  }

  /**
   * Build the renderer's injected face.
   * @returns reactive state and staged-edit actions for the Settings section.
   */
  inject(): McpSettingsFace {
    return {
      hooks: { mcpSettings: this.store },
      setEnabled: (enabled) => { this.setEnabled(enabled) },
      addServer: () => { this.addServer() },
      importJson: text => this.importJson(text),
      removeServer: (id) => { this.removeServer(id) },
      editServer: (id, patch) => { this.editServer(id, patch) },
      testServer: (id) => { void this.testServer(id) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  /**
   * Stage the master switch without loading anything until save.
   * @param enabled - whether valid, individually enabled records should load after the next save.
   */
  setEnabled(enabled: boolean): void {
    if (this.draft.enabled === enabled) return
    this.draft = { ...this.draft, enabled }
    this.changed()
  }

  /** Add a blank local-program record with a stable, collision-free id. */
  addServer(): void {
    let id: string
    do {
      this.nextId += 1
      id = `server-${String(this.nextId)}`
    } while (Object.hasOwn(this.draft.servers, id))
    this.draft = {
      ...this.draft,
      servers: {
        ...this.draft.servers,
        [id]: {
          enabled: false,
          transport: 'stdio',
          serverName: id,
          command: '',
          args: [],
          env: {},
          cwd: '',
          url: '',
        },
      },
    }
    this.changed()
  }

  /**
   * Append fully parsed MCP records to this draft; persistence still requires Save.
   *
   * @param text - pasted MCP JSON configuration.
   * @returns the count appended or the reason the paste was rejected.
   */
  importJson(text: string): McpJsonImportResult {
    const parsed = parseMcpJson(text)
    if (!parsed.ok) return parsed
    const servers = { ...this.draft.servers }
    for (const record of parsed.records) {
      const id = this.nextImportedId(record.idHint, servers)
      servers[id] = cloneServer(record.server)
    }
    this.draft = { ...this.draft, servers }
    this.changed()
    return { ok: true, count: parsed.records.length }
  }

  /**
   * Remove a staged record.
   * @param id - stable user-record identifier.
   */
  removeServer(id: string): void {
    if (!Object.hasOwn(this.draft.servers, id)) return
    this.cancelTest(id)
    const { [id]: _removed, ...servers } = this.draft.servers
    this.draft = { ...this.draft, servers }
    this.changed()
  }

  /**
   * Replace selected fields of one staged record.
   * @param id - stable user-record identifier.
   * @param patch - editable fields replacing the record's current values.
   */
  editServer(id: string, patch: Partial<McpServerSettings>): void {
    const current = this.draft.servers[id]
    if (current === undefined) return
    this.cancelTest(id)
    this.draft = {
      ...this.draft,
      servers: {
        ...this.draft.servers,
        [id]: {
          ...current,
          ...patch,
          ...patch.args === undefined ? {} : { args: [...patch.args] },
          ...patch.env === undefined ? {} : { env: { ...patch.env } },
        },
      },
    }
    this.changed()
  }

  /**
   * Start a disposable, unsaved connection test for one staged record.
   *
   * @param id - stable local record identifier.
   */
  private async testServer(id: string): Promise<void> {
    const server = this.draft.servers[id]
    if (server === undefined || this.testControllers.has(id)) return
    if (serverIssue({ ...server, enabled: true }) !== undefined) {
      this.tests.set(id, { status: 'failure', reason: 'invalid-configuration' })
      this.publish()
      return
    }
    const signature = JSON.stringify(server)
    const controller = new AbortController()
    this.testControllers.set(id, controller)
    this.tests.set(id, { status: 'testing' })
    this.publish()

    let result: McpConnectionTestResult
    try {
      result = await this.tester.test(cloneServer(server), controller.signal)
    } catch {
      result = controller.signal.aborted
        ? { ok: false, reason: 'cancelled' }
        : { ok: false, reason: 'connection-failed' }
    }
    if (this.testControllers.get(id) !== controller || this.draft.servers[id] === undefined
      || JSON.stringify(this.draft.servers[id]) !== signature) return
    this.testControllers.delete(id)
    this.tests.set(id, result.ok
      ? { status: 'success', toolCount: result.toolCount }
      : { status: 'failure', reason: result.reason })
    this.publish()
  }

  /** Drop local edits and return to the latest Host-accepted collection. */
  discard(): void {
    if (!this.dirty && !this.failed) return
    this.cancelAllTests()
    this.draft = cloneSettings(this.committed)
    this.dirty = false
    this.failed = false
    this.publish()
  }

  /** Persist the staged collection and retain it when the Host does not accept it. */
  async save(): Promise<void> {
    const current = this.form.getSnapshot()
    if (!this.dirty || this.saving || current.status !== 'ready' || !current.writable) return
    const desired = cloneSettings(this.draft)
    this.saving = true
    this.failed = false
    this.publish()
    try {
      if (desired.enabled) {
        const serversAccepted = await this.form.set('servers', desired.servers)
        const enabledAccepted = serversAccepted && await this.form.set('enabled', true)
        if (!enabledAccepted) {
          this.saving = false
          this.failed = true
          this.publish()
          return
        }
      } else {
        const disabledAccepted = await this.form.set('enabled', false)
        const serversAccepted = disabledAccepted && await this.form.set('servers', desired.servers)
        if (!serversAccepted) {
          this.saving = false
          this.failed = true
          this.publish()
          return
        }
      }
    } catch {
      this.saving = false
      this.failed = true
      this.publish()
      return
    }
    const accepted = this.form.getSnapshot().value
    if (accepted !== undefined && sameSettings(normalizeSettings(accepted), desired)) {
      this.committed = cloneSettings(desired)
      this.draft = cloneSettings(desired)
      this.dirty = false
      this.failed = false
    } else {
      this.failed = true
    }
    this.saving = false
    this.publish()
  }

  /** Adopt one Host refresh without overwriting a local draft. */
  private adopt(): void {
    const accepted = this.form.getSnapshot().value
    if (accepted !== undefined) {
      this.committed = normalizeSettings(accepted)
      if (!this.dirty && !this.saving) {
        this.cancelAllTests()
        this.draft = cloneSettings(this.committed)
      }
      this.dirty = !sameSettings(this.draft, this.committed)
    }
    this.publish()
  }

  /** Mark a local draft mutation and publish it. */
  private changed(): void {
    this.dirty = !sameSettings(this.draft, this.committed)
    this.failed = false
    this.publish()
  }

  /** Build the current renderer snapshot. */
  private project(): McpSettingsState {
    const snapshot = this.form.getSnapshot()
    return {
      status: snapshot.status,
      writable: snapshot.writable,
      settings: cloneSettings(this.draft),
      dirty: this.dirty,
      saving: this.saving,
      failed: this.failed,
      tests: Object.fromEntries(this.tests),
    }
  }

  /** Publish a fresh immutable-facing projection. */
  private publish(): void {
    this.store.set(this.project())
  }

  /** Allocate an unambiguous local id while preserving a useful imported map key when possible. */
  private nextImportedId(idHint: string, servers: Record<string, McpServerSettings>): string {
    if (isSafeRecordId(idHint) && !Object.hasOwn(servers, idHint)) return idHint
    if (isSafeRecordId(idHint)) {
      let suffix = 2
      while (Object.hasOwn(servers, `${idHint}-${String(suffix)}`)) suffix += 1
      return `${idHint}-${String(suffix)}`
    }
    let id: string
    do {
      this.nextId += 1
      id = `server-${String(this.nextId)}`
    } while (Object.hasOwn(servers, id))
    return id
  }

  /** Abort and forget one in-flight or completed test result after its record changes. */
  private cancelTest(id: string): void {
    this.testControllers.get(id)?.abort()
    this.testControllers.delete(id)
    this.tests.delete(id)
  }

  /** Abort every connection test before replacing the draft or disposing this controller. */
  private cancelAllTests(): void {
    for (const controller of this.testControllers.values()) controller.abort()
    this.testControllers.clear()
    this.tests.clear()
  }
}
