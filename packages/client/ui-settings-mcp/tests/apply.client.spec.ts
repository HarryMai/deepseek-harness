/** Custom Configuration top-level Settings slot registration. */

import Schema from '@deepseek-ai/schemastery'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import { McpSettingsSection } from '../src/client/McpSettingsSection.tsx'
import type { McpSettingsSectionInjected } from '../src/client/McpSettingsSection.tsx'

const SETTINGS_SCHEMA = Schema.object({
  enabled: Schema.boolean().default(false),
  servers: Schema.dict(Schema.object({
    transport: Schema.union(['stdio', 'streamable-http']).default('stdio'),
    serverName: Schema.string().default(''),
    command: Schema.string().default(''),
    args: Schema.array(Schema.string()).default([]),
    cwd: Schema.string().default(''),
    url: Schema.string().default(''),
  })).default({}),
})

async function bench() {
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
          ns: 'mcp-client',
          schema: SETTINGS_SCHEMA.toJSON(),
          value: { enabled: false, servers: {} },
          base: { enabled: false, servers: {} },
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
  new TestRemote(ctx, { settings })
  ctx.provide('connection', {
    isLoopback: true,
    api: { settings },
  } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, locale, slots: ctx.get('slots') as SlotRegistry }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-mcp apply', () => {
  it('declares the client services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'configForms'])
  })

  it('registers a Chinese Custom Configuration tab at the same Settings level as Models and Agent Presets', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entry = slots.entries('settings.section')[0]!
    expect(entry.component).toBe(McpSettingsSection)
    expect(entry.options).toMatchObject({ id: 'custom-config', order: 30 })
    expect(resolveSlotLabel(entry.options.label)).toBe('自定义配置')
    const face = (entry.inject as unknown as () => McpSettingsSectionInjected)()
    expect(face.hooks.mcpSettings.getSnapshot()).toMatchObject({ settings: { enabled: false, servers: {} } })
    await vi.waitFor(() => {
      expect(face.hooks.mcpSettings.getSnapshot()).toMatchObject({
        status: 'ready', writable: true, settings: { enabled: false, servers: {} },
      })
    })
    await ctx.fiber.dispose()
  })

  it('registers after the Settings slot declaration arrives and removes the tab on teardown', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toEqual([])

    declareRoot(slots)
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
    await fiber.dispose()
    expect(slots.entries('settings.section')).toEqual([])
    await ctx.fiber.dispose()
  })
})
