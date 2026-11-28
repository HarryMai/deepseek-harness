/** Client entry registration and loopback test-push RPC adapter tests. */

import Schema from '@deepseek-ai/schemastery'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, NotificationsSettingsSection, type NotificationsSettingsSectionInjected } from '../src/client/index.ts'
import { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATIONS_RPC_CHANNEL, NOTIFICATIONS_SETTINGS_NAMESPACE, NOTIFICATIONS_TEST_ENDPOINT } from '../src/types.ts'

const SETTINGS_SCHEMA = Schema.object({
  enabled: Schema.boolean().default(false),
  events: Schema.object({
    approvalRequired: Schema.boolean().default(true),
    manualActionRequired: Schema.boolean().default(true),
    passiveInterruption: Schema.boolean().default(true),
    taskCompleted: Schema.boolean().default(true),
  }).default({ ...DEFAULT_NOTIFICATION_SETTINGS.events }),
  channels: Schema.dict(Schema.object({
    enabled: Schema.boolean().default(false),
    provider: Schema.union(['bark']).default('bark'),
    name: Schema.string().default(''),
    serverUrl: Schema.string().default('https://api.day.app'),
    deviceKey: Schema.string().default(''),
    group: Schema.string().default('DSH'),
    sound: Schema.string().default(''),
    level: Schema.union(['', 'active', 'timeSensitive', 'passive']).default(''),
  })).default({}),
})

async function bench(options: { isLoopback?: boolean; rpcCall?: ReturnType<typeof vi.fn> } = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const settings = {
    describe: vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: NOTIFICATIONS_SETTINGS_NAMESPACE,
          schema: SETTINGS_SCHEMA.toJSON(),
          value: DEFAULT_NOTIFICATION_SETTINGS,
          base: DEFAULT_NOTIFICATION_SETTINGS,
          user: {},
          applies: 'live' as const,
          secrets: [],
          revision: 0,
        }],
      },
    })),
    update: vi.fn(),
    replace: vi.fn(),
    mutate: vi.fn(),
  }
  const rpcCall = options.rpcCall ?? vi.fn(async () => ({ ok: true, value: { ok: true, statusCode: 200 } }))
  new TestRemote(ctx, { settings })
  ctx.provide('connection', {
    isLoopback: options.isLoopback ?? true,
    api: { settings },
    rpc: { call: rpcCall },
  } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, locale, rpcCall, slots: ctx.get('slots') as SlotRegistry }
}

function declareCustomConfigRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.custom-config.item': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

function readInjectedFace(slots: SlotRegistry): NotificationsSettingsSectionInjected {
  const entry = slots.entries('settings.custom-config.item')[0]!
  return (entry.inject as never as () => NotificationsSettingsSectionInjected)()
}

describe('ui-settings-notifications client apply', () => {
  it('declares required client services and registers under settings.custom-config.item', async () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'configForms'])
    const { ctx, locale, rpcCall, slots } = await bench()
    declareCustomConfigRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entry = slots.entries('settings.custom-config.item')[0]!
    expect(entry.component).toBe(NotificationsSettingsSection)
    expect(entry.options).toMatchObject({ id: 'notifications', order: 20 })
    expect(resolveSlotLabel(entry.options.label)).toBe('消息通知')

    locale.setLocale('en')
    expect(resolveSlotLabel(entry.options.label)).toBe('Mobile notifications')

    const face = readInjectedFace(slots)
    await vi.waitFor(() => {
      expect(face.hooks.notificationSettings.getSnapshot().status).toBe('ready')
    })

    // Trigger test push over loopback RPC
    face.addChannel()
    face.editChannel('channel-1', { serverUrl: 'https://api.day.app', deviceKey: 'my-key' })
    face.testChannel('channel-1')
    await vi.waitFor(() => {
      expect(face.hooks.notificationSettings.getSnapshot().tests['channel-1']).toEqual({ status: 'success' })
    })
    expect(rpcCall).toHaveBeenCalledTimes(1)
    const firstCall = rpcCall.mock.calls[0] as [string, string, { channel: { deviceKey: string } }, AbortSignal]
    expect(firstCall[0]).toBe(NOTIFICATIONS_RPC_CHANNEL)
    expect(firstCall[1]).toBe(NOTIFICATIONS_TEST_ENDPOINT)
    expect(firstCall[2].channel.deviceKey).toBe('my-key')
    expect(firstCall[3]).toBeInstanceOf(AbortSignal)

    await ctx.fiber.dispose()
  })

  it('handles non-loopback, malformed RPC replies, and RPC exceptions cleanly', async () => {
    const nonLoopback = await bench({ isLoopback: false })
    declareCustomConfigRoot(nonLoopback.slots)
    await nonLoopback.ctx.plugin({ inject: [...inject], apply }).await()
    const nonLoopbackFace = readInjectedFace(nonLoopback.slots)
    await vi.waitFor(() => { expect(nonLoopbackFace.hooks.notificationSettings.getSnapshot().status).toBe('ready') })
    nonLoopbackFace.addChannel()
    nonLoopbackFace.editChannel('channel-1', { serverUrl: 'https://api.day.app', deviceKey: 'k' })
    nonLoopbackFace.testChannel('channel-1')
    await vi.waitFor(() => {
      expect(nonLoopbackFace.hooks.notificationSettings.getSnapshot().tests['channel-1']).toEqual({
        status: 'failure',
        reason: 'unavailable',
      })
    })
    await nonLoopback.ctx.fiber.dispose()

    const malformedRpc = vi.fn(async () => ({ ok: true, value: { bad: true } }))
    const malformed = await bench({ rpcCall: malformedRpc })
    declareCustomConfigRoot(malformed.slots)
    await malformed.ctx.plugin({ inject: [...inject], apply }).await()
    const malformedFace = readInjectedFace(malformed.slots)
    await vi.waitFor(() => { expect(malformedFace.hooks.notificationSettings.getSnapshot().status).toBe('ready') })
    malformedFace.addChannel()
    malformedFace.editChannel('channel-1', { serverUrl: 'https://api.day.app', deviceKey: 'k' })
    malformedFace.testChannel('channel-1')
    await vi.waitFor(() => {
      expect(malformedFace.hooks.notificationSettings.getSnapshot().tests['channel-1']).toEqual({
        status: 'failure',
        reason: 'request-failed',
      })
    })
    await malformed.ctx.fiber.dispose()

    const throwingRpc = vi.fn(async () => { throw new Error('network down') })
    const failed = await bench({ rpcCall: throwingRpc })
    declareCustomConfigRoot(failed.slots)
    await failed.ctx.plugin({ inject: [...inject], apply }).await()
    const failedFace = readInjectedFace(failed.slots)
    await vi.waitFor(() => { expect(failedFace.hooks.notificationSettings.getSnapshot().status).toBe('ready') })
    failedFace.addChannel()
    failedFace.editChannel('channel-1', { serverUrl: 'https://api.day.app', deviceKey: 'k' })
    failedFace.testChannel('channel-1')
    await vi.waitFor(() => {
      expect(failedFace.hooks.notificationSettings.getSnapshot().tests['channel-1']).toEqual({
        status: 'failure',
        reason: 'request-failed',
      })
    })
    await failed.ctx.fiber.dispose()
  })
})
