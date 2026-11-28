/** Browser entry for the personal mobile notifications panel inside Settings -> Custom Configuration. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-mcp/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import {
  NOTIFICATIONS_RPC_CHANNEL,
  NOTIFICATIONS_SETTINGS_NAMESPACE,
  NOTIFICATIONS_TEST_ENDPOINT,
  type NotificationChannelSettings,
  type NotificationSettings,
  type PushDeliveryResult,
} from '../types.ts'
import { en, zh, type NotificationSettingsKey } from './locales.ts'
import { NotificationSettingsController, type NotificationPushTester } from './settings.ts'
import { NotificationsSettingsSection, type NotificationsSettingsSectionInjected } from './NotificationsSettingsSection.tsx'

export type { NotificationsSettingsSectionInjected, NotificationsSettingsSectionProps } from './NotificationsSettingsSection.tsx'
export type {
  ChannelTestState,
  NotificationPushTester,
  NotificationSettingsFace,
  NotificationSettingsState,
} from './settings.ts'
export type { NotificationSettingsKey } from './locales.ts'
export { NotificationSettingsController } from './settings.ts'
export { NotificationsSettingsSection } from './NotificationsSettingsSection.tsx'

/** Locale namespace owned by the personal mobile notifications settings UI. */
const NS = 'settings.customerNotifications'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Personal mobile push notification settings panel. */
    'settings.customerNotifications': NotificationSettingsKey
  }
}

/** Required client services. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'configForms']

/**
 * Register the mobile notification configuration tab inside Settings -> Custom Configuration.
 *
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const tester: NotificationPushTester = {
    async test(channel: NotificationChannelSettings, signal: AbortSignal): Promise<PushDeliveryResult> {
      if (!connection.isLoopback) return { ok: false, reason: 'unavailable' }
      try {
        const result = await connection.rpc.call(
          NOTIFICATIONS_RPC_CHANNEL,
          NOTIFICATIONS_TEST_ENDPOINT,
          { channel },
          signal,
        )
        return result.ok && isPushDeliveryResult(result.value)
          ? result.value
          : { ok: false, reason: 'request-failed' }
      } catch (_rpcFailed) {
        // Translate RPC transport failures into localized browser-safe status values.
        return signal.aborted
          ? { ok: false, reason: 'cancelled' }
          : { ok: false, reason: 'request-failed' }
      }
    },
  }

  const controller = new NotificationSettingsController(
    ctx.configForms.get<NotificationSettings>(NOTIFICATIONS_SETTINGS_NAMESPACE),
    tester,
  )

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'customer-notifications: dictionaries')
  ctx.effect(() => () => { controller.dispose() }, 'customer-notifications: settings controller')

  const t = ctx.locale.bind(NS)
  const injected = (): NotificationsSettingsSectionInjected => controller.inject()

  ctx.slots.inject('settings.custom-config.item', () => ctx.slots.register({
    name: 'settings.custom-config.item',
    id: 'notifications',
    order: 20,
    label: () => t('tabLabel'),
    locale: NS,
    inject: injected,
  }, NotificationsSettingsSection))
}

/** Validate untrusted RPC return values before rendering them in the UI. */
function isPushDeliveryResult(value: unknown): value is PushDeliveryResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.ok === true) {
    return candidate.statusCode === undefined
      || (typeof candidate.statusCode === 'number' && Number.isInteger(candidate.statusCode))
  }
  return candidate.ok === false
    && (candidate.reason === 'invalid-configuration'
      || candidate.reason === 'unsupported-provider'
      || candidate.reason === 'http-error'
      || candidate.reason === 'request-failed'
      || candidate.reason === 'timed-out'
      || candidate.reason === 'cancelled'
      || candidate.reason === 'unavailable')
    && (candidate.statusCode === undefined
      || (typeof candidate.statusCode === 'number' && Number.isInteger(candidate.statusCode)))
}
