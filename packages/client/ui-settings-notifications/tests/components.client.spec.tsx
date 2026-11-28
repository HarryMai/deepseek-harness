// @vitest-environment jsdom
/** Visible UI interaction and staged persistence tests for NotificationsSettingsSection. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { NotificationsSettingsSection, type NotificationsSettingsSectionProps } from '../src/client/NotificationsSettingsSection.tsx'
import { NotificationSettingsController, type NotificationPushTester } from '../src/client/settings.ts'
import { zh, type NotificationSettingsKey } from '../src/client/locales.ts'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from '../src/types.ts'

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

class MemoryConfigForm implements ConfigForm<NotificationSettings> {
  readonly writes: string[] = []
  failWrites = false
  private readonly listeners = new Set<() => void>()
  private snapshot: ConfigFormSnapshot<NotificationSettings>

  constructor(initial: Partial<ConfigFormSnapshot<NotificationSettings>> = {}) {
    this.snapshot = {
      status: 'ready',
      value: structuredClone(DEFAULT_NOTIFICATION_SETTINGS),
      base: structuredClone(DEFAULT_NOTIFICATION_SETTINGS),
      user: {},
      revision: 0,
      writable: true,
      ...initial,
    }
  }

  getSnapshot(): ConfigFormSnapshot<NotificationSettings> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async mutate(): Promise<boolean> { return true }

  async set(field: string, value: unknown): Promise<boolean> {
    if (this.failWrites) throw new Error('rejected')
    this.writes.push(field)
    this.snapshot = {
      ...this.snapshot,
      value: { ...this.snapshot.value!, [field]: structuredClone(value) },
      user: { ...(this.snapshot.user as Record<string, unknown>), [field]: structuredClone(value) },
    }
    for (const listener of this.listeners) listener()
    return true
  }

  async unset(_field: string): Promise<boolean> { return true }
}

function renderPanel(form = new MemoryConfigForm(), tester?: NotificationPushTester) {
  const controller = new NotificationSettingsController(form, tester)
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: NotificationsSettingsSectionProps = {
    ...controller.inject(),
    useNotificationSettings: bindSnapshotSelector(controller.store),
    useContextMenu: unusedHook,
    useRemoteAccess: unusedHook,
    useSessionAccess: unusedHook,
    useSessions: unusedHook,
    useSessionStatus: unusedHook,
    useSessionRetainInfo: unusedHook,
    usePanelInfo,
    useResource,
    useWorkspaceAccess: unusedHook,
    useWorkspaces: unusedHook,
    t: (key, values) => (zh[key as NotificationSettingsKey] ?? '').replace(/\{(\w+)\}/gu, (_match, name: string) => {
      const value = values?.[name]
      if (value === undefined) return `{${name}}`
      if (typeof value === 'string') return value
      if (typeof value === 'number' || typeof value === 'boolean') return String(value)
      return JSON.stringify(value) ?? ''
    }),
  }
  return { controller, form, ...render(<NotificationsSettingsSection {...props} />) }
}

describe('NotificationsSettingsSection', () => {
  it('configures Bark channel, toggles triggers, tests push without saving, and persists staged edits', async () => {
    const tester: NotificationPushTester = {
      test: async () => ({ ok: true, statusCode: 200 }),
    }
    const { form } = renderPanel(new MemoryConfigForm(), tester)

    const master = screen.getByRole<HTMLInputElement>('checkbox', { name: '启用消息通知推送' })
    expect(master.checked).toBe(false)
    fireEvent.click(master)

    // Toggle one of the four triggers off and back on
    const completedToggle = screen.getByRole<HTMLInputElement>('checkbox', { name: /任务已完成/u })
    expect(completedToggle.checked).toBe(true)
    fireEvent.click(completedToggle)
    expect(completedToggle.checked).toBe(false)
    fireEvent.click(completedToggle)
    expect(completedToggle.checked).toBe(true)

    // Add a Bark channel (starts disabled)
    fireEvent.click(screen.getByRole('button', { name: '添加推送通道' }))
    const channelEnabled = screen.getByRole<HTMLInputElement>('checkbox', { name: '启用此通道' })
    expect(channelEnabled.checked).toBe(false)
    expect(screen.getByText('此通道已关闭；保存后不会推送消息。')).toBeTruthy()

    // Test before filling Device Key shows validation failure without writing settings
    fireEvent.click(screen.getByRole('button', { name: '测试推送' }))
    await waitFor(() => {
      expect(screen.getByText('请先补齐有效的服务地址和 Device Key。')).toBeTruthy()
    })

    // Enable and fill Bark fields
    fireEvent.click(channelEnabled)
    expect(screen.getByText('请填写 Device Key 后再启用。')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('通道名称'), { target: { value: '我的 iPhone' } })
    fireEvent.change(screen.getByLabelText('服务地址'), { target: { value: 'https://bark.example.test' } })
    const keyInput = screen.getByLabelText<HTMLInputElement>('Device Key')
    expect(keyInput.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: '显示' }))
    expect(keyInput.type).toBe('text')
    fireEvent.change(keyInput, { target: { value: 'bark-device-key-123' } })
    fireEvent.change(screen.getByLabelText('消息分组（可选）'), { target: { value: 'DSH-Work' } })
    fireEvent.change(screen.getByLabelText('提示音（可选）'), { target: { value: 'minuet' } })
    fireEvent.change(screen.getByLabelText('通知级别'), { target: { value: 'timeSensitive' } })

    expect(screen.getByText('此通道已就绪，将在选定事件发生时推送消息。')).toBeTruthy()

    // Send test push without saving
    fireEvent.click(screen.getByRole('button', { name: '测试推送' }))
    await waitFor(() => {
      expect(screen.getByText('测试通知已发送，请在移动设备上查收。')).toBeTruthy()
    })
    expect(form.writes).toEqual([])

    // Save writes events, channels, then enabled
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(form.writes).toEqual(['events', 'channels', 'enabled'])
    })
    expect(screen.queryByText('未保存的修改')).toBeNull()
  })

  it('renders loading, unavailable, read-only, discard, remove, and error states cleanly', async () => {
    const loading = renderPanel(new MemoryConfigForm({ status: 'loading', value: undefined }))
    expect(screen.getByText('正在加载消息通知配置…')).toBeTruthy()
    loading.unmount()

    const unavailable = renderPanel(new MemoryConfigForm({ status: 'unavailable', value: undefined }))
    expect(screen.getByText('当前应用未开放消息通知配置。')).toBeTruthy()
    unavailable.unmount()

    const form = new MemoryConfigForm({ writable: true })
    form.failWrites = true
    const failingTester: NotificationPushTester = {
      test: async () => ({ ok: false, reason: 'http-error', statusCode: 400 }),
    }
    renderPanel(form, failingTester)
    fireEvent.click(screen.getByRole('button', { name: '添加推送通道' }))
    fireEvent.change(screen.getByLabelText('Device Key'), { target: { value: 'bad-key' } })
    fireEvent.click(screen.getByRole('button', { name: '测试推送' }))
    await waitFor(() => {
      expect(screen.getByText('推送服务返回异常状态（HTTP 400）。')).toBeTruthy()
    })

    // Save failure retains draft edits and displays error status
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(screen.getByText('应用未接受这些修改，内容仍保留在这里供你修正。')).toBeTruthy()
    })

    // Discard restores clean state
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    expect(screen.getByText('尚未添加任何推送通道。')).toBeTruthy()
  })
})
