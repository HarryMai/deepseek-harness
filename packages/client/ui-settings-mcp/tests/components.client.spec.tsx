// @vitest-environment jsdom
/** Visible Custom Configuration fields for stdio and Streamable HTTP records. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { McpSettingsSection } from '../src/client/McpSettingsSection.tsx'
import type { McpSettingsSectionProps } from '../src/client/McpSettingsSection.tsx'
import { DEFAULT_MCP_SETTINGS, McpSettingsController } from '../src/client/settings.ts'
import type { McpConnectionTester, McpSettings } from '../src/client/settings.ts'
import { zh, type McpSettingsKey } from '../src/client/locales.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

class MemoryScope implements SettingsScope<McpSettings> {
  readonly writes: string[] = []
  private readonly listeners = new Set<() => void>()
  private snapshot: SettingsScopeSnapshot<McpSettings> = {
    status: 'ready',
    value: structuredClone(DEFAULT_MCP_SETTINGS),
    base: structuredClone(DEFAULT_MCP_SETTINGS),
    user: {},
    revision: 0,
    writable: true,
    mode: 'host',
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
    this.writes.push(field)
    this.snapshot = {
      ...this.snapshot,
      value: { ...this.snapshot.value!, [field]: structuredClone(value) },
      user: { ...(this.snapshot.user as Record<string, unknown>), [field]: structuredClone(value) },
    }
    for (const listener of this.listeners) listener()
  }

  async unset(_field: string): Promise<void> {}
}

function renderSection(scope = new MemoryScope(), tester?: McpConnectionTester) {
  const controller = new McpSettingsController(scope, tester)
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: McpSettingsSectionProps = {
    ...controller.inject(),
    useMcpSettings: bindSnapshotSelector(controller.store),
    useSessions: unusedHook,
    useSessionPendingInteraction: unusedHook,
    usePanelInfo,
    useResource,
    useWorkspaces: unusedHook,
    t: (key, values) => (zh[key as McpSettingsKey] ?? '').replace(/\{(\w+)\}/gu, (_match, name: string) => {
      const value = values?.[name]
      return value === undefined ? `{${name}}` : String(value)
    }),
    close: () => {},
  }
  return { controller, scope, ...render(<McpSettingsSection {...props} />) }
}

describe('McpSettingsSection', () => {
  it('keeps each added service off until its independent switch is enabled, then saves both switch levels', async () => {
    const { scope } = renderSection()

    expect(screen.getByText(/应用不会内置任何命令或服务地址/u)).toBeTruthy()
    const enabled = screen.getByRole<HTMLInputElement>('checkbox', { name: '启用已保存的 MCP 服务' })
    expect(enabled.checked).toBe(false)
    fireEvent.click(enabled)
    fireEvent.click(screen.getByRole('button', { name: '添加 MCP 服务' }))

    const serviceEnabled = screen.getByRole<HTMLInputElement>('checkbox', { name: '启用此 MCP 服务' })
    expect(serviceEnabled.checked).toBe(false)
    expect(screen.getByText('此服务已关闭；保存后不会加载。')).toBeTruthy()
    fireEvent.click(serviceEnabled)
    fireEvent.change(screen.getByLabelText('服务名称'), { target: { value: 'codegraph' } })
    fireEvent.change(screen.getByLabelText('命令或可执行程序'), { target: { value: '/usr/local/bin/codegraph' } })
    expect(screen.getByText('此服务已启用；打开 MCP 总开关后会加载。')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('连接类型'), { target: { value: 'streamable-http' } })
    expect(screen.queryByLabelText('命令或可执行程序')).toBeNull()
    fireEvent.change(screen.getByLabelText('MCP 服务地址'), { target: { value: 'https://mcp.example.test/mcp' } })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(scope.writes).toEqual(['servers', 'enabled']) })
    expect(screen.queryByText('未保存的修改')).toBeNull()
  })

  it('does not let a disabled record block an enabled record with the same name', async () => {
    const { controller } = renderSection()

    controller.addServer()
    controller.editServer('server-1', { serverName: 'codegraph' })
    controller.addServer()
    controller.editServer('server-2', { enabled: true, serverName: 'codegraph', command: 'codegraph' })

    await waitFor(() => {
      expect(screen.getByText('此服务已启用；打开 MCP 总开关后会加载。')).toBeTruthy()
      expect(screen.queryByText('每个已保存的 MCP 服务都需要不同的服务名称。')).toBeNull()
    })
  })

  it('imports pasted MCP JSON as disabled records and tests a draft connection without saving it', async () => {
    const tester: McpConnectionTester = { test: async () => ({ ok: true, toolCount: 2 }) }
    const { scope } = renderSection(new MemoryScope(), tester)

    fireEvent.click(screen.getByRole('button', { name: '导入 JSON' }))
    fireEvent.change(screen.getByLabelText('MCP JSON 配置'), {
      target: { value: JSON.stringify({ mcpServers: { codegraph: { command: 'codegraph', args: ['serve'] } } }) },
    })
    fireEvent.click(screen.getByRole('button', { name: '导入' }))
    await waitFor(() => { expect(screen.getByText('已导入 1 个 MCP 服务，全部保持关闭。')).toBeTruthy() })

    const serviceEnabled = screen.getByRole<HTMLInputElement>('checkbox', { name: '启用此 MCP 服务' })
    expect(serviceEnabled.checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    await waitFor(() => { expect(screen.getByText('连接成功，发现 2 个工具。')).toBeTruthy() })
    expect(scope.writes).toEqual([])
  })

  it('renders stdio arguments and environment variables as repeatable rows', () => {
    const { controller } = renderSection()

    fireEvent.click(screen.getByRole('button', { name: '添加 MCP 服务' }))
    expect(screen.getByRole('textbox', { name: '参数 1' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '键 1' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '值 1' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '添加参数' }))
    expect(screen.getByRole('textbox', { name: '参数 2' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '参数 1' }), { target: { value: '--mcp' } })
    fireEvent.change(screen.getByRole('textbox', { name: '参数 2' }), { target: { value: 'serve' } })

    fireEvent.click(screen.getByRole('button', { name: '添加环境变量' }))
    fireEvent.change(screen.getByRole('textbox', { name: '键 1' }), { target: { value: 'NODE_ENV' } })
    fireEvent.change(screen.getByRole('textbox', { name: '值 1' }), { target: { value: 'test' } })
    fireEvent.change(screen.getByRole('textbox', { name: '键 2' }), { target: { value: 'CODEGRAPH_HOME' } })
    fireEvent.change(screen.getByRole('textbox', { name: '值 2' }), { target: { value: '/work' } })

    expect(controller.store.getSnapshot().settings.servers['server-1']).toMatchObject({
      args: ['--mcp', 'serve'],
      env: { NODE_ENV: 'test', CODEGRAPH_HOME: '/work' },
    })

    fireEvent.click(screen.getByRole('button', { name: '删除参数 1' }))
    expect(controller.store.getSnapshot().settings.servers['server-1']?.args).toEqual(['serve'])
    fireEvent.click(screen.getByRole('button', { name: '删除环境变量 1' }))
    expect(controller.store.getSnapshot().settings.servers['server-1']?.env).toEqual({ CODEGRAPH_HOME: '/work' })
  })
})
