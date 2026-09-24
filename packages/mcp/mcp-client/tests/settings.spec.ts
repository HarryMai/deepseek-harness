/** Profile-backed MCP settings resolve into dynamic Loader child entries. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type EntryGroup } from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import * as settingsPlugin from '@deepseek-ai/dsh-mcp-client/src/settings.ts'
import {
  DEFAULT_MCP_SETTINGS,
  MCP_SETTINGS_GROUP_ID,
  MCP_SETTINGS_NAMESPACE,
  McpClientSettingsManager,
  McpSettingsConfig,
  name,
  resolveMcpClientEntries,
} from '@deepseek-ai/dsh-mcp-client/src/settings.ts'

const contexts: Context[] = []

afterEach(async () => {
  while (contexts.length > 0) await contexts.pop()!.fiber.dispose()
})

interface DynamicEvents {
  started: string[]
  stopped: string[]
}

interface ManagerHarness {
  ctx: Context
  managerId: string
  group: EntryGroup
}

/** Boot the profile manager and substitute its external MCP clients with lifecycle recorders. */
async function bootManager(events: DynamicEvents): Promise<ManagerHarness> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  ctx.loader.internal = {
    import: async (specifier: string) => {
      if (specifier === '@deepseek-ai/dsh-mcp-client/settings') return settingsPlugin
      if (specifier === '@deepseek-ai/dsh-mcp-client') {
        return {
          name: 'test-mcp-client',
          apply: (child: Context, config: { serverName: string }) => {
            events.started.push(config.serverName)
            child.effect(() => () => { events.stopped.push(config.serverName) })
          },
        }
      }
      throw new Error(`unexpected Loader import ${specifier}`)
    },
  } as never
  const groupOptions = { id: MCP_SETTINGS_GROUP_ID, name: 'cordis:group', group: true, config: [] }
  await ctx.loader.create(groupOptions)
  const managerOptions = {
    id: MCP_SETTINGS_NAMESPACE,
    name: '@deepseek-ai/dsh-mcp-client/settings',
    config: {},
  }
  const managerId = await ctx.loader.create(managerOptions)
  await ctx.loader.await()
  return { ctx, managerId, group: ctx.loader.resolveGroup(MCP_SETTINGS_GROUP_ID) }
}

describe('mcp-client settings configuration', () => {
  it('defaults to a disabled collection with no server records', () => {
    const config = McpSettingsConfig({})
    expect(config.enabled.get()).toBe(DEFAULT_MCP_SETTINGS.enabled)
    expect(config.servers.get()).toEqual(DEFAULT_MCP_SETTINGS.servers)
    expect(resolveMcpClientEntries(DEFAULT_MCP_SETTINGS)).toEqual({ entries: [], issues: [] })
  })

  it('defaults each saved server to disabled until that server is explicitly enabled', () => {
    const config = McpSettingsConfig({
      enabled: true,
      servers: {
        codegraph: {
          transport: 'stdio', serverName: 'codegraph', command: 'codegraph', args: ['serve', '--mcp'], cwd: '', url: '',
        },
      },
    })

    const settings = { enabled: config.enabled.get(), servers: config.servers.get() }
    expect(settings.servers.codegraph?.enabled).toBe(false)
    expect(resolveMcpClientEntries(settings)).toEqual({ entries: [], issues: [] })
  })

  it('maps individually enabled stdio and Streamable HTTP records to independent client entries', () => {
    const resolved = resolveMcpClientEntries({
      enabled: true,
      servers: {
        codegraph: {
          enabled: true,
          transport: 'stdio',
          serverName: 'codegraph',
          command: 'codegraph',
          args: ['serve', '--mcp'],
          env: { CODEGRAPH_HOME: '/work' },
          cwd: '/work',
          url: '',
        },
        node_repl: {
          enabled: false,
          transport: 'stdio',
          serverName: 'node_repl',
          command: '/fixture/node_repl',
          args: [],
          cwd: '',
          url: '',
        },
        'computer-use': {
          enabled: false,
          transport: 'stdio',
          serverName: 'computer-use',
          command: './Codex Computer Use.app/Contents/MacOS/SkyComputerUseClient',
          args: ['mcp'],
          cwd: '.',
          url: '',
        },
        docs: {
          enabled: true,
          transport: 'streamable-http',
          serverName: 'docs',
          command: '',
          args: [],
          cwd: '',
          url: 'https://mcp.example.test/mcp',
        },
      },
    })

    expect(resolved.issues).toEqual([])
    expect(resolved.entries).toEqual([
      {
        id: 'mcp-codegraph',
        name: '@deepseek-ai/dsh-mcp-client',
        config: {
          transport: 'stdio',
          serverName: 'codegraph',
          command: 'codegraph',
          args: ['serve', '--mcp'],
          env: { CODEGRAPH_HOME: '/work' },
          cwd: '/work',
          failOnStartupError: false,
        },
      },
      {
        id: 'mcp-docs',
        name: '@deepseek-ai/dsh-mcp-client',
        config: {
          transport: 'streamable-http',
          serverName: 'docs',
          url: 'https://mcp.example.test/mcp',
          failOnStartupError: false,
        },
      },
    ])
  })

  it('leaves incomplete, invalid, and duplicate records unloaded without rejecting valid peers', () => {
    const resolved = resolveMcpClientEntries({
      enabled: true,
      servers: {
        good: {
          enabled: true, transport: 'stdio', serverName: 'good', command: 'node', args: ['server.mjs'], cwd: '', url: '',
        },
        incomplete: {
          enabled: true, transport: 'stdio', serverName: 'incomplete', command: '', args: [], cwd: '', url: '',
        },
        invalidName: {
          enabled: true, transport: 'streamable-http', serverName: 'not valid', command: '', args: [], cwd: '', url: 'https://mcp.example.test',
        },
        duplicate: {
          enabled: true, transport: 'streamable-http', serverName: 'good', command: '', args: [], cwd: '', url: 'https://other.example.test',
        },
      },
    })

    expect(resolved.entries.map(entry => entry.id)).toEqual(['mcp-good'])
    expect(resolved.issues).toEqual([
      { id: 'duplicate', reason: 'duplicate-server-name' },
      { id: 'incomplete', reason: 'incomplete' },
      { id: 'invalidName', reason: 'invalid-server-name' },
    ])
  })

  it('skips stdio records with invalid environment names or values', () => {
    const resolved = resolveMcpClientEntries({
      enabled: true,
      servers: {
        invalid: {
          enabled: true, transport: 'stdio', serverName: 'invalid', command: 'node', args: [],
          env: { 'BAD=NAME': 'value' }, cwd: '', url: '',
        },
      },
    })
    expect(resolved).toEqual({ entries: [], issues: [{ id: 'invalid', reason: 'invalid-environment' }] })
  })

  it('uses the MCP settings profile id and mounts a separate Loader group', () => {
    expect(MCP_SETTINGS_NAMESPACE).toBe('mcp-client')
    expect(MCP_SETTINGS_GROUP_ID).toBe('mcp-settings')
    expect(name).toBe('mcp-client-settings')
    expect(McpClientSettingsManager.Config).toBe(McpSettingsConfig)
    expect(settingsPlugin.Config).toBe(McpSettingsConfig)
  })

  it('starts valid enabled servers and reconciles profile updates by stopping replaced clients', async () => {
    const events: DynamicEvents = { started: [], stopped: [] }
    const harness = await bootManager(events)
    expect(harness.group.data).toEqual([])

    await harness.ctx.loader.resolve(harness.managerId).update({
      config: {
        enabled: true,
        servers: {
          codegraph: {
            enabled: true, transport: 'stdio', serverName: 'codegraph', command: 'codegraph', args: ['serve', '--mcp'], cwd: '', url: '',
          },
          node_repl: {
            enabled: false, transport: 'stdio', serverName: 'node_repl', command: '/fixture/node_repl', args: [], cwd: '', url: '',
          },
        },
      },
    })
    await vi.waitFor(() => {
      expect(harness.group.data.map(entry => entry.id)).toEqual(['mcp-codegraph'])
      expect(events.started).toEqual(['codegraph'])
    })

    await harness.ctx.loader.resolve(harness.managerId).update({
      config: {
        enabled: true,
        servers: {
          codegraph: {
            enabled: false, transport: 'stdio', serverName: 'codegraph', command: 'codegraph', args: ['serve', '--mcp'], cwd: '', url: '',
          },
          node_repl: {
            enabled: true, transport: 'stdio', serverName: 'node_repl', command: '/fixture/node_repl', args: [], cwd: '', url: '',
          },
        },
      },
    })
    await vi.waitFor(() => {
      expect(harness.group.data.map(entry => entry.id)).toEqual(['mcp-node_repl'])
      expect(events.started).toEqual(['codegraph', 'node_repl'])
      expect(events.stopped).toEqual(['codegraph'])
    })

    await harness.ctx.loader.resolve(harness.managerId).update({
      config: {
        enabled: false,
        servers: {
          codegraph: {
            enabled: false, transport: 'stdio', serverName: 'codegraph', command: 'codegraph', args: ['serve', '--mcp'], cwd: '', url: '',
          },
          node_repl: {
            enabled: true, transport: 'stdio', serverName: 'node_repl', command: '/fixture/node_repl', args: [], cwd: '', url: '',
          },
        },
      },
    })
    await vi.waitFor(() => {
      expect(harness.group.data).toEqual([])
      expect(events.stopped).toEqual(['codegraph', 'node_repl'])
    })
  })
})
