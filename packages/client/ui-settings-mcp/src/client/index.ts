/** Browser entry for the Custom Configuration MCP settings section. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only imports expose the slot, locale, remote, and configuration-form Context faces.
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { McpSettingsSection } from './McpSettingsSection.tsx'
import type { McpSettingsSectionInjected } from './McpSettingsSection.tsx'
import { MCP_SETTINGS_NAMESPACE, McpSettingsController } from './settings.ts'
import type { McpConnectionTestResult, McpConnectionTester, McpServerSettings } from './settings.ts'
import { en, zh, type McpSettingsKey } from './locales.ts'

export type { McpSettingsSectionInjected, McpSettingsSectionProps } from './McpSettingsSection.tsx'
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
  const injected = (): McpSettingsSectionInjected => controller.inject()

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'custom-config',
    order: 30,
    label: () => t('nav'),
    locale: NS,
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
