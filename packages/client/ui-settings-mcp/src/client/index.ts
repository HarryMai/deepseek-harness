/** Browser entry for the Custom Configuration MCP settings section. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only imports expose the slot, locale, remote, and configuration-form Context faces.
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { McpSettingsSection } from './McpSettingsSection.tsx'
import type {
  CustomConfigItemOwnerProps,
  CustomConfigItemTab,
  McpSettingsSectionInjected,
} from './McpSettingsSection.tsx'
import { MCP_SETTINGS_NAMESPACE, McpSettingsController } from './settings.ts'
import type { McpConnectionTestResult, McpConnectionTester, McpServerSettings } from './settings.ts'
import { en, zh, type McpSettingsKey } from './locales.ts'

export type {
  CustomConfigItemOwnerProps,
  CustomConfigItemTab,
  McpSettingsSectionInjected,
  McpSettingsSectionProps,
} from './McpSettingsSection.tsx'
export type {
  McpConnectionTestFailure, McpConnectionTestResult, McpConnectionTestState, McpConnectionTester,
  McpJsonImportFailure, McpJsonImportResult, McpJsonParseResult, McpSettingsFace, McpSettingsState,
  McpServerIssue, McpServerSettings, McpSettings, ParsedMcpServer,
} from './settings.ts'
export type { McpSettingsKey } from './locales.ts'

/** Locale namespace owned by this settings page. */
const NS = 'settings.mcp'
const MCP_SETTINGS_RPC_CHANNEL = '/mcp-settings'
const MCP_SETTINGS_TEST_ENDPOINT = 'test'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Custom Configuration MCP settings page. */
    'settings.mcp': McpSettingsKey
  }

  interface SlotMap {
    /** Extensible sub-tab contributed into Settings -> Custom Configuration. */
    'settings.custom-config.item': { kind: 'list'; scope: 'root'; owner: CustomConfigItemOwnerProps }
  }
}

/** Required client services. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'configForms']

/**
 * Register the MCP configuration page alongside Models and Agent Presets.
 *
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const tester: McpConnectionTester = {
    async test(server: McpServerSettings, signal: AbortSignal): Promise<McpConnectionTestResult> {
      if (!connection.isLoopback) return { ok: false, reason: 'unavailable' }
      try {
        const result = await connection.rpc.call(
          MCP_SETTINGS_RPC_CHANNEL,
          MCP_SETTINGS_TEST_ENDPOINT,
          { server },
          signal,
        )
        return result.ok && isMcpConnectionTestResult(result.value)
          ? result.value
          : { ok: false, reason: 'connection-failed' }
      } catch {
        return signal.aborted
          ? { ok: false, reason: 'cancelled' }
          : { ok: false, reason: 'connection-failed' }
      }
    },
  }
  const controller = new McpSettingsController(ctx.configForms.get(MCP_SETTINGS_NAMESPACE), tester)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mcp: dictionaries')
  ctx.effect(() => () => { controller.dispose() }, 'ui-settings-mcp: settings controller')
  const t = ctx.locale.bind(NS)
  let itemsVersion = -1
  let itemsRevision = -1
  let items: readonly CustomConfigItemTab[] = []
  const customConfigItems = {
    getSnapshot: (): readonly CustomConfigItemTab[] => {
      const version = ctx.slots.getVersion('settings.custom-config.item')
      const revision = ctx.locale.getSnapshot().revision
      if (version !== itemsVersion || revision !== itemsRevision) {
        itemsVersion = version
        itemsRevision = revision
        items = ctx.slots.entries('settings.custom-config.item')
          .map(entry => ({
            /* v8 ignore next -- list-slot registration requires id */
            id: entry.options.id ?? '',
            order: entry.options.order ?? 0,
            label: resolveSlotLabel(entry.options.label) ?? entry.options.id ?? '',
          }))
          .sort((left, right) => left.order - right.order)
      }
      return items
    },
    subscribe: (listener: () => void): (() => void) => {
      const offLedger = ctx.slots.subscribe('settings.custom-config.item', listener)
      const offLocale = ctx.locale.subscribe(listener)
      return () => {
        offLedger()
        offLocale()
      }
    },
  }
  const injected = (): McpSettingsSectionInjected => {
    const face = controller.inject()
    return {
      ...face,
      hooks: {
        ...face.hooks,
        customConfigItems,
      },
    }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'custom-config',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    children: { 'settings.custom-config.item': { kind: 'list', scope: 'root' } },
    inject: injected,
  }, McpSettingsSection))
}

/** Verify an untrusted RPC value before it enters the staged UI state. */
function isMcpConnectionTestResult(value: unknown): value is McpConnectionTestResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  if (result.ok === true) return typeof result.toolCount === 'number'
    && Number.isSafeInteger(result.toolCount) && result.toolCount >= 0
  return result.ok === false
    && (result.reason === 'invalid-configuration' || result.reason === 'connection-failed'
      || result.reason === 'timed-out' || result.reason === 'cancelled' || result.reason === 'unavailable')
}
