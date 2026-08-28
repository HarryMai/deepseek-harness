/** Browser-side draft and save behavior for user-owned MCP records. */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_MCP_SETTINGS, McpSettingsController, parseMcpJson, serverIssue,
} from '../src/client/settings.ts'
import type { McpConnectionTester, McpSettings } from '../src/client/settings.ts'

class MemoryScope implements SettingsScope<McpSettings> {
  readonly writes: Array<{ field: string; value: unknown }> = []
  private readonly listeners = new Set<() => void>()
  private snapshot: SettingsScopeSnapshot<McpSettings>

  constructor(value: McpSettings = DEFAULT_MCP_SETTINGS, readonly writable = true) {
    this.snapshot = {
      status: 'ready',
      value: structuredClone(value),
      base: structuredClone(DEFAULT_MCP_SETTINGS),
      user: {},
      revision: 0,
      writable,
      mode: 'host',
    }
  }

  getSnapshot(): SettingsScopeSnapshot<McpSettings> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async mutate(): Promise<void> {}

  async set(field: string, value: unknown): Promise<void> {
    this.writes.push({ field, value: structuredClone(value) })
    this.snapshot = {
      ...this.snapshot,
      value: { ...this.snapshot.value!, [field]: structuredClone(value) },
      user: { ...(this.snapshot.user as Record<string, unknown>), [field]: structuredClone(value) },
      revision: (this.snapshot.revision ?? 0) + 1,
    }
    for (const listener of this.listeners) listener()
  }

  async unset(_field: string): Promise<void> {}
}

describe('McpSettingsController', () => {
  it('defaults every added service to disabled, stages individual switches, then saves records before enabling the collection', async () => {
    const scope = new MemoryScope()
    const controller = new McpSettingsController(scope)

    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', writable: true, dirty: false, settings: DEFAULT_MCP_SETTINGS,
    })
    controller.addServer()
    controller.editServer('server-1', {
      serverName: 'codegraph', command: '/usr/local/bin/codegraph', args: ['serve'], env: { CODEGRAPH_HOME: '/work' }, cwd: '/work',
    })
    controller.addServer()
    controller.editServer('server-2', {
      transport: 'streamable-http', serverName: 'docs', url: 'https://mcp.example.test/mcp',
    })
    expect(controller.store.getSnapshot().settings.servers).toMatchObject({
      'server-1': { enabled: false },
      'server-2': { enabled: false },
    })
    controller.editServer('server-1', { enabled: true })
    controller.setEnabled(true)

    await controller.save()

    expect(scope.writes.map(write => write.field)).toEqual(['servers', 'enabled'])
    expect(scope.getSnapshot().value).toEqual({
      enabled: true,
      servers: {
        'server-1': {
          enabled: true, transport: 'stdio', serverName: 'codegraph', command: '/usr/local/bin/codegraph', args: ['serve'], env: { CODEGRAPH_HOME: '/work' }, cwd: '/work', url: '',
        },
        'server-2': {
          enabled: false, transport: 'streamable-http', serverName: 'docs', command: '', args: [], env: {}, cwd: '', url: 'https://mcp.example.test/mcp',
        },
      },
    })
    expect(controller.store.getSnapshot()).toMatchObject({ dirty: false, failed: false, settings: scope.getSnapshot().value })
    const reopened = new McpSettingsController(scope)
    expect(reopened.store.getSnapshot()).toMatchObject({
      dirty: false,
      settings: {
        enabled: true,
        servers: {
          'server-1': { enabled: true },
          'server-2': { enabled: false },
        },
      },
    })
    reopened.dispose()
  })

  it('writes disablement before changing records, so live clients stop before their collection is replaced', async () => {
    const scope = new MemoryScope({
      enabled: true,
      servers: {
        local: { enabled: true, transport: 'stdio', serverName: 'local', command: 'node', args: [], cwd: '', url: '' },
      },
    })
    const controller = new McpSettingsController(scope)

    controller.setEnabled(false)
    controller.removeServer('local')
    await controller.save()

    expect(scope.writes.map(write => write.field)).toEqual(['enabled', 'servers'])
    expect(scope.getSnapshot().value).toEqual(DEFAULT_MCP_SETTINGS)
  })

  it('surfaces the conditions that leave a saved record unloaded', () => {
    expect(serverIssue({
      enabled: false, transport: 'stdio', serverName: '', command: '', args: [], cwd: '', url: '',
    })).toBe('disabled')
    expect(serverIssue({
      enabled: true, transport: 'streamable-http', serverName: 'not valid', command: '', args: [], cwd: '', url: 'https://mcp.example.test',
    })).toBe('invalid-server-name')
    expect(serverIssue({
      enabled: true, transport: 'streamable-http', serverName: 'valid', command: '', args: [], cwd: '', url: 'file:///tmp/mcp',
    })).toBe('invalid-url')
    expect(serverIssue({
      enabled: true, transport: 'stdio', serverName: 'local', command: '/usr/bin/local', args: [], cwd: '', url: '',
    })).toBeUndefined()
    expect(serverIssue({
      enabled: true, transport: 'stdio', serverName: 'local', command: '/usr/bin/local', args: [], cwd: '', url: '',
    }, true)).toBe('duplicate-server-name')
    expect(serverIssue({
      enabled: true, transport: 'stdio', serverName: 'local', command: '/usr/bin/local', args: [], env: { 'BAD=NAME': 'value' }, cwd: '', url: '',
    })).toBe('invalid-environment')
  })

  it('parses standard MCP JSON maps into disabled staged records without changing the master switch', () => {
    const parsed = parseMcpJson(JSON.stringify({
      mcpServers: {
        codegraph: { command: 'codegraph', args: ['serve', '--mcp'], cwd: '/work' },
        docs: { type: 'http', url: 'https://mcp.example.test/mcp' },
      },
    }))
    expect(parsed).toEqual({
      ok: true,
      records: [
        {
          idHint: 'codegraph',
          server: {
            enabled: false, transport: 'stdio', serverName: 'codegraph', command: 'codegraph',
            args: ['serve', '--mcp'], env: {}, cwd: '/work', url: '',
          },
        },
        {
          idHint: 'docs',
          server: {
            enabled: false, transport: 'streamable-http', serverName: 'docs', command: '',
            args: [], env: {}, cwd: '', url: 'https://mcp.example.test/mcp',
          },
        },
      ],
    })

    const scope = new MemoryScope({ enabled: true, servers: {} })
    const controller = new McpSettingsController(scope)
    expect(controller.inject().importJson(JSON.stringify({
      mcp_servers: { node_repl: { command: 'node', args: ['repl.mjs'] } },
    }))).toEqual({ ok: true, count: 1 })
    expect(controller.store.getSnapshot().settings).toEqual({
      enabled: true,
      servers: {
        node_repl: {
          enabled: false, transport: 'stdio', serverName: 'node_repl', command: 'node',
          args: ['repl.mjs'], env: {}, cwd: '', url: '',
        },
      },
    })
    expect(scope.writes).toEqual([])
    controller.dispose()
  })

  it('imports stdio environment variables and still rejects unsupported HTTP headers', () => {
    expect(parseMcpJson(JSON.stringify({
      servers: { codegraph: { command: 'codegraph', env: { TOKEN: 'secret' } } },
    }))).toMatchObject({ ok: true, records: [{ server: { env: { TOKEN: 'secret' } } }] })
    expect(parseMcpJson(JSON.stringify({
      mcpServers: { docs: { url: 'https://mcp.example.test/mcp', headers: { Authorization: 'secret' } } },
    }))).toEqual({ ok: false, reason: 'unsupported-fields' })
    expect(parseMcpJson(JSON.stringify({
      mcpServers: { codegraph: { command: 'codegraph', env: { TOKEN: 1 } } },
    }))).toEqual({ ok: false, reason: 'invalid-server' })
    expect(parseMcpJson(JSON.stringify({
      mcpServers: { codegraph: { command: 'codegraph', env: { 'BAD=NAME': 'value' } } },
    }))).toEqual({ ok: false, reason: 'invalid-server' })
  })

  it('tests a disabled draft record without saving, enabling, or retaining stale test results after an edit', async () => {
    const pending: PromiseWithResolvers<{ ok: true; toolCount: number }> = Promise.withResolvers()
    const tester: McpConnectionTester = { test: vi.fn(() => pending.promise) }
    const scope = new MemoryScope()
    const controller = new McpSettingsController(scope, tester)
    controller.addServer()
    controller.editServer('server-1', { serverName: 'codegraph', command: 'codegraph', args: ['serve'] })

    controller.inject().testServer('server-1')
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().tests).toEqual({ 'server-1': { status: 'testing' } })
    })
    expect(tester.test).toHaveBeenCalledWith({
      enabled: false, transport: 'stdio', serverName: 'codegraph', command: 'codegraph', args: ['serve'], env: {}, cwd: '', url: '',
    }, expect.any(AbortSignal))
    expect(scope.writes).toEqual([])

    controller.editServer('server-1', { args: ['serve', '--mcp'] })
    pending.resolve({ ok: true, toolCount: 4 })
    await Promise.resolve()
    expect(controller.store.getSnapshot().tests).toEqual({})
    expect(controller.store.getSnapshot().settings.servers['server-1']?.enabled).toBe(false)
    expect(scope.writes).toEqual([])
    controller.dispose()
  })

  it('reports a successful temporary connection test without persisting its result', async () => {
    const tester: McpConnectionTester = { test: vi.fn(async () => ({ ok: true as const, toolCount: 6 })) }
    const scope = new MemoryScope()
    const controller = new McpSettingsController(scope, tester)
    controller.addServer()
    controller.editServer('server-1', { serverName: 'computer-use', command: 'computer-use' })

    controller.inject().testServer('server-1')
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().tests).toEqual({ 'server-1': { status: 'success', toolCount: 6 } })
    })
    expect(scope.writes).toEqual([])
    expect(controller.store.getSnapshot().settings.enabled).toBe(false)
    controller.dispose()
  })
})
