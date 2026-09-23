/** Dynamic user-owned MCP settings resolve into Loader child entries. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { EntryGroup } from '@deepseek-ai/cordis-plugin-loader'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import * as settingsPlugin from '@deepseek-ai/dsh-mcp-client/src/settings.ts'
import {
  DEFAULT_MCP_SETTINGS, MCP_SETTINGS_NAMESPACE, McpClientSettingsGroup,
  McpSettingsConfig, inject, name, resolveMcpClientEntries,
} from '@deepseek-ai/dsh-mcp-client/src/settings.ts'

const contexts: Context[] = []
const directories: string[] = []

afterEach(async () => {
  while (contexts.length > 0) await contexts.pop()!.fiber.dispose()
  while (directories.length > 0) await rm(directories.pop()!, { recursive: true, force: true })
})

interface DynamicEvents {
  started: string[]
  stopped: string[]
}

/** Boot the real settings manager while substituting its external child module with a lifecycle recorder. */
async function bootManager(directory: string, events: DynamicEvents): Promise<{ ctx: Context; group: EntryGroup; patchPath: string }> {
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
            apply: (child: Context, config: { serverName: string }) => {
              events.started.push(config.serverName)
              child.effect(() => () => { events.stopped.push(config.serverName) })
            },
          }
        }
        throw new Error(`unexpected Loader import ${specifier}`)
      },
    } as never
    Object.assign(root.loader.builtins, { editor: ConfigEditor, settings: Settings })
  })
  contexts.push(ctx)
  const entry = ctx.loader.entries().find(candidate => candidate.options.id === MCP_SETTINGS_NAMESPACE)
  const group = entry?.subgroup
  if (group === undefined) throw new Error('MCP settings entry did not create a Loader group')
  return { ctx, group, patchPath: profile.patchPath }
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

  it('keeps the settings manager as a Loader group and does not bake a server into its entry config', () => {
    expect(MCP_SETTINGS_NAMESPACE).toBe('mcp-client')
    expect(name).toBe('mcp-client-settings')
    expect(inject).toEqual([])
    expect(McpClientSettingsGroup.prototype).toBeInstanceOf(EntryGroup)
  })

  it('persists master and per-server switches, restores them on the next boot, and unloads only the switched record', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-mcp-settings-'))
    directories.push(directory)
    const firstEvents: DynamicEvents = { started: [], stopped: [] }
    const first = await bootManager(directory, firstEvents)

    expect(first.group.data).toEqual([])
    await first.ctx.settings.update(MCP_SETTINGS_NAMESPACE, {
      enabled: true,
      servers: {
        codegraph: {
          enabled: true, transport: 'stdio', serverName: 'codegraph', command: 'codegraph', args: ['serve', '--mcp'], cwd: '', url: '',
        },
        node_repl: {
          enabled: false, transport: 'stdio', serverName: 'node_repl', command: '/fixture/node_repl', args: [], cwd: '', url: '',
        },
        'computer-use': {
          enabled: false, transport: 'stdio', serverName: 'computer-use', command: './Codex Computer Use.app/Contents/MacOS/SkyComputerUseClient', args: ['mcp'], cwd: '.', url: '',
        },
      },
    })
    await vi.waitFor(() => {
      expect(first.group.data.map(entry => entry.id)).toEqual(['mcp-codegraph'])
      expect(firstEvents.started).toEqual(['codegraph'])
    })
    const persisted = await readFile(first.patchPath, 'utf8')
    expect(persisted).toMatch(/codegraph:\n\s+enabled: true/u)
    expect(persisted).toMatch(/node_repl:\n\s+enabled: false/u)
    expect(persisted).toMatch(/computer-use:\n\s+enabled: false/u)

    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)
    expect(firstEvents.stopped).toEqual(['codegraph'])

    const secondEvents: DynamicEvents = { started: [], stopped: [] }
    const second = await bootManager(directory, secondEvents)
    await vi.waitFor(() => {
      expect(second.group.data.map(entry => entry.id)).toEqual(['mcp-codegraph'])
      expect(secondEvents.started).toEqual(['codegraph'])
    })

    await second.ctx.settings.update(MCP_SETTINGS_NAMESPACE, {
      servers: {
        codegraph: {
          enabled: false, transport: 'stdio', serverName: 'codegraph', command: 'codegraph', args: ['serve', '--mcp'], cwd: '', url: '',
        },
        node_repl: {
          enabled: true, transport: 'stdio', serverName: 'node_repl', command: '/fixture/node_repl', args: [], cwd: '', url: '',
        },
        'computer-use': {
          enabled: false, transport: 'stdio', serverName: 'computer-use', command: './Codex Computer Use.app/Contents/MacOS/SkyComputerUseClient', args: ['mcp'], cwd: '.', url: '',
        },
      },
    })
    await vi.waitFor(() => {
      expect(second.group.data.map(entry => entry.id)).toEqual(['mcp-node_repl'])
      expect(secondEvents.started).toEqual(['codegraph', 'node_repl'])
      expect(secondEvents.stopped).toEqual(['codegraph'])
    })

    await second.ctx.settings.update(MCP_SETTINGS_NAMESPACE, { enabled: false })
    await vi.waitFor(() => {
      expect(second.group.data).toEqual([])
      expect(secondEvents.stopped).toEqual(['codegraph', 'node_repl'])
    })
  })
})
