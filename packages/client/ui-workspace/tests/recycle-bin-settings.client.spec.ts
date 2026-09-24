import { describe, expect, it } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { RecycleBinSettings } from '../src/client/recycle-bin-settings.ts'
import {
  DEFAULT_RECYCLE_BIN_SETTINGS, RecycleBinSettingsController,
} from '../src/client/recycle-bin-settings.ts'

describe('RecycleBinSettingsController', () => {
  it('projects the default retention while the Host settings scope is loading', () => {
    const settings = stubConfigForm<RecycleBinSettings>()
    const controller = new RecycleBinSettingsController(settings.scope)

    expect(controller.store.getSnapshot()).toEqual({
      status: 'loading',
      writable: false,
      retentionDays: DEFAULT_RECYCLE_BIN_SETTINGS.retentionDays,
      saving: false,
      failed: false,
    })

    controller.dispose()
    expect(settings.listenerCount()).toBe(0)
  })

  it('persists a valid retention value through SettingsScope and adopts the Host acceptance', async () => {
    const settings = stubConfigForm<RecycleBinSettings>()
    settings.publish({
      status: 'ready',
      writable: true,
      value: { retentionDays: 30 },
      revision: 4,
    })
    settings.set.mockImplementation((field: string, value: unknown) => {
      expect(field).toBe('retentionDays')
      settings.publish({
        value: { retentionDays: value as number },
        revision: 5,
        user: { retentionDays: value },
      })
    })
    const controller = new RecycleBinSettingsController(settings.scope)

    await controller.saveRetentionDays(45)

    expect(settings.set).toHaveBeenCalledWith('retentionDays', 45)
    expect(controller.store.getSnapshot()).toEqual({
      status: 'ready',
      writable: true,
      retentionDays: 45,
      saving: false,
      failed: false,
    })
    controller.dispose()
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid retention value %s without writing',
    async (retentionDays) => {
      const settings = stubConfigForm<RecycleBinSettings>()
      settings.publish({
        status: 'ready',
        writable: true,
        value: { retentionDays: 30 },
      })
      const controller = new RecycleBinSettingsController(settings.scope)

      await controller.saveRetentionDays(retentionDays)

      expect(settings.set).not.toHaveBeenCalled()
      expect(controller.store.getSnapshot()).toMatchObject({
        status: 'ready',
        writable: true,
        retentionDays: 30,
        saving: false,
        failed: true,
      })
      controller.dispose()
    },
  )

  it.each([
    { name: 'unavailable', status: 'unavailable' as const, writable: false },
    { name: 'read-only', status: 'ready' as const, writable: false },
  ])('does not write when the settings scope is $name', async ({ status, writable }) => {
    const settings = stubConfigForm<RecycleBinSettings>()
    settings.publish({
      status,
      writable,
      value: { retentionDays: 30 },
    })
    const controller = new RecycleBinSettingsController(settings.scope)

    await controller.saveRetentionDays(45)

    expect(settings.set).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot()).toMatchObject({
      status,
      writable,
      retentionDays: 30,
      saving: false,
      failed: false,
    })
    controller.dispose()
  })
})
