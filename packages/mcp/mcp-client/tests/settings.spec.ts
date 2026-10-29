/** Dynamic user-owned MCP settings resolve into Loader child entries. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent, Inbox } from '@deepseek-ai/dsh-agent'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import * as settingsPlugin from '@deepseek-ai/dsh-mcp-client/src/settings.ts'
import {
  DEFAULT_MCP_SETTINGS, MCP_SETTINGS_NAMESPACE,
  McpSettingsConfig, inject, name, resolveMcpClientEntries,
} from '@deepseek-ai/dsh-mcp-client/src/settings.ts'
import type { McpSettings } from '@deepseek-ai/dsh-mcp-client/src/settings.ts'

const contexts: Context[] = []
const directories: string[] = []

afterEach(async () => {
  while (contexts.length > 0) await contexts.pop()!.fiber.dispose()
  while (directories.length > 0) await rm(directories.pop()!, { recursive: true, force: true })
})

interface DynamicEventRecord {
  serverName: string
  cwd: string
}

interface DynamicEvents {
  started: DynamicEventRecord[]
  stopped: DynamicEventRecord[]
}

const emptyInbox: Inbox = {
  nextTurn: [],
  nextStep: [],
  clear: () => {},
  append: () => {},
  prepend: () => {},
  replace: () => false,
  remove: () => false,
  splice: () => [],
}

function createMockAgent(ctx: Context, id: string, sessionCwd?: string): Agent {
  const holder: { ctx?: Context } = {}
  const sessionId = SessionId(id)
  const agent: Agent = {
    id: sessionId,
    options: {},
    session: Session.create(sessionId, undefined, {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 0,
      isSeeded: false,
      ...sessionCwd !== undefined ? { cwd: sessionCwd } : {},
    }),
    model: {
      current: () => undefined,
      select: () => {},
    },
    inbox: emptyInbox,
    status: 'idle',
    get ctx() { return holder.ctx! },
    cancel: () => {},
    whenIdle: async () => {},
    runMaintenance: async task => task(new AbortController().signal),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
  }
  const scope = createScope(ctx.extend(), agent)
  holder.ctx = scope.ctx
  return agent
}

/** Boot the real settings manager while substituting its external child module with a lifecycle recorder. */
async function bootManager(directory: string, events: DynamicEvents): Promise<{ ctx: Context; patchPath: string }> {
  const home = directory
  const profileDir = join(home, 'profiles', 'test')
  initProfile(profileDir, ['test-bundle'])
  const bundleDir = join(profileDir, 'node_modules', 'test-bundle')
  await mkdir(bundleDir, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}\n')
  await writeFile(join(bundleDir, 'package.json'), JSON.stringify({
    name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  await writeFile(join(bundleDir, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    {
      id: MCP_SETTINGS_NAMESPACE,
      name: '@deepseek-ai/dsh-mcp-client/settings',
      config: { enabled: false, servers: {} },
    },
  ] }]))
  const configPath = join(profileDir, 'cordis.yml')
  await writeFile(configPath, '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir: profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'),
    cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const ctx = await boot('test', configPath, readProfilePatches('test', profile), (root) => {
    root.provide('profileContext', profile)
    root.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    root.loader.internal = {
      import: async (specifier: string) => {
        if (specifier === '@deepseek-ai/dsh-mcp-client/settings') return settingsPlugin
        if (specifier === '@deepseek-ai/dsh-mcp-client') {
          return {
            name: 'test-mcp-client',
            apply: (child: Context, config: { serverName: string; cwd: string }) => {
              events.started.push({ serverName: config.serverName, cwd: config.cwd })
              child.effect(() => () => { events.stopped.push({ serverName: config.serverName, cwd: config.cwd }) })
            },
          }
        }
        throw new Error(`unexpected Loader import ${specifier}`)
      },
    } as never
    Object.assign(root.loader.builtins, { editor: ConfigEditor, settings: Settings })
  })
  contexts.push(ctx)
  return { ctx, patchPath: profile.patchPath }
}

describe('mcp-client settings configuration', () => {
  it('defaults to disabled with no server records', () => {
    expect(McpSettingsConfig({})).toEqual(DEFAULT_MCP_SETTINGS)
    expect(resolveMcpClientEntries(DEFAULT_MCP_SETTINGS)).toEqual({ entries: [], issues: [] })
  })

  it('defaults each saved server to disabled until that server is explicitly enabled', () => {
    const settings = McpSettingsConfig({
      enabled: true,
      servers: {
        codegraph: {
          transport: 'stdio', serverName: 'codegraph', command: 'codegraph', args: ['serve', '--mcp'], cwd: '', url: '',
        },
      },
    })

    expect(settings.servers.codegraph?.enabled).toBe(false)
    expect(resolveMcpClientEntries(settings)).toEqual({ entries: [], issues: [] })
  })

  it('maps only individually enabled stdio and Streamable HTTP records to independent client entries', () => {
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
          enabled: true, transport: 'stdio', serverName: 'good', command: 'node', args: ['server.mjs'], cwd: '/work', url: '',
        },
        incomplete: {
          enabled: true, transport: 'stdio', serverName: 'incomplete', command: '', args: [], cwd: '/work', url: '',
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

  it('prefers session project directory over configured cwd, falls back to configured cwd, and reports missing-cwd when both are blank', () => {
    const settings: McpSettings = {
      enabled: true,
      servers: {
        prefersSession: {
          enabled: true, transport: 'stdio', serverName: 'prefers_session', command: 'node', args: [], env: {}, cwd: '/fallback', url: '',
        },
        fallbackConfig: {
          enabled: true, transport: 'stdio', serverName: 'fallback_config', command: 'node', args: [], env: {}, cwd: '/fallback', url: '',
        },
        missingCwd: {
          enabled: true, transport: 'stdio', serverName: 'missing_cwd', command: 'node', args: [], env: {}, cwd: '', url: '',
        },
      },
    }

    const withSession = resolveMcpClientEntries(settings, '/session/project')
    expect(withSession.issues).toEqual([])
    expect(withSession.entries.map(e => (e.config as { cwd: string }).cwd)).toEqual([
      '/session/project',
      '/session/project',
      '/session/project',
    ])

    const withoutSession = resolveMcpClientEntries(settings, '')
    expect(withoutSession.issues).toEqual([
      { id: 'missingCwd', reason: 'missing-cwd' },
    ])
    expect(withoutSession.entries.map(e => (e.config as { cwd: string }).cwd)).toEqual([
      '/fallback',
      '/fallback',
    ])
  })

  it('skips stdio records with invalid environment names or values', () => {
    const resolved = resolveMcpClientEntries({
      enabled: true,
      servers: {
        invalid: {
          enabled: true, transport: 'stdio', serverName: 'invalid', command: 'node', args: [],
          env: { 'BAD=NAME': 'value' }, cwd: '/work', url: '',
        },
      },
    })
    expect(resolved).toEqual({ entries: [], issues: [{ id: 'invalid', reason: 'invalid-environment' }] })
  })

  it('registers under the mcp-client namespace and does not bake a server into its entry config', () => {
    expect(MCP_SETTINGS_NAMESPACE).toBe('mcp-client')
    expect(name).toBe('mcp-client-settings')
    expect(inject).toEqual([])
  })

  it('persists master and per-server switches, mounts independent clients per agent session with session cwds, and unloads on agent disposal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-mcp-settings-'))
    directories.push(directory)
    const firstEvents: DynamicEvents = { started: [], stopped: [] }
    const first = await bootManager(directory, firstEvents)

    await first.ctx.settings.update(MCP_SETTINGS_NAMESPACE, {
      enabled: true,
      servers: {
        codegraph: {
          enabled: true, transport: 'stdio', serverName: 'codegraph', command: 'codegraph', args: ['serve', '--mcp'], cwd: '/fallback-dir', url: '',
        },
        node_repl: {
          enabled: false, transport: 'stdio', serverName: 'node_repl', command: '/fixture/node_repl', args: [], cwd: '/work', url: '',
        },
        'computer-use': {
          enabled: false, transport: 'stdio', serverName: 'computer-use', command: './Codex Computer Use.app/Contents/MacOS/SkyComputerUseClient', args: ['mcp'], cwd: '.', url: '',
        },
      },
    })

    const agent1 = createMockAgent(first.ctx, 'agent-1', '/project-a')
    const agent2 = createMockAgent(first.ctx, 'agent-2', undefined)

    await first.ctx.parallel('agent/created', { agent: agent1, source: 'startup' })
    await first.ctx.parallel('agent/created', { agent: agent2, source: 'startup' })

    await vi.waitFor(() => {
      expect(firstEvents.started).toEqual([
        { serverName: 'codegraph', cwd: '/project-a' },
        { serverName: 'codegraph', cwd: '/fallback-dir' },
      ])
    })
    const persisted = await readFile(first.patchPath, 'utf8')
    expect(persisted).toMatch(/codegraph:\n\s+enabled: true/u)
    expect(persisted).toMatch(/node_repl:\n\s+enabled: false/u)
    expect(persisted).toMatch(/computer-use:\n\s+enabled: false/u)

    await first.ctx.parallel('agent/disposed', { agent: agent1 })
    await vi.waitFor(() => {
      expect(firstEvents.stopped).toEqual([
        { serverName: 'codegraph', cwd: '/project-a' },
      ])
    })

    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)
    await vi.waitFor(() => {
      expect(firstEvents.stopped).toEqual([
        { serverName: 'codegraph', cwd: '/project-a' },
        { serverName: 'codegraph', cwd: '/fallback-dir' },
      ])
    })

    const secondEvents: DynamicEvents = { started: [], stopped: [] }
    const second = await bootManager(directory, secondEvents)

    const agentSecond = createMockAgent(second.ctx, 'agent-second', '/project-b')
    await second.ctx.parallel('agent/created', { agent: agentSecond, source: 'startup' })

    await vi.waitFor(() => {
      expect(secondEvents.started).toEqual([
        { serverName: 'codegraph', cwd: '/project-b' },
      ])
    })

    await second.ctx.settings.update(MCP_SETTINGS_NAMESPACE, {
      servers: {
        codegraph: {
          enabled: false, transport: 'stdio', serverName: 'codegraph', command: 'codegraph', args: ['serve', '--mcp'], cwd: '/fallback-dir', url: '',
        },
        node_repl: {
          enabled: true, transport: 'stdio', serverName: 'node_repl', command: '/fixture/node_repl', args: [], cwd: '/work', url: '',
        },
        'computer-use': {
          enabled: false, transport: 'stdio', serverName: 'computer-use', command: './Codex Computer Use.app/Contents/MacOS/SkyComputerUseClient', args: ['mcp'], cwd: '.', url: '',
        },
      },
    })
    await vi.waitFor(() => {
      expect(secondEvents.started).toEqual([
        { serverName: 'codegraph', cwd: '/project-b' },
        { serverName: 'node_repl', cwd: '/project-b' },
      ])
      expect(secondEvents.stopped).toEqual([
        { serverName: 'codegraph', cwd: '/project-b' },
      ])
    })

    await second.ctx.settings.update(MCP_SETTINGS_NAMESPACE, { enabled: false })
    await vi.waitFor(() => {
      expect(secondEvents.stopped).toEqual([
        { serverName: 'codegraph', cwd: '/project-b' },
        { serverName: 'node_repl', cwd: '/project-b' },
      ])
    })
  })
})
