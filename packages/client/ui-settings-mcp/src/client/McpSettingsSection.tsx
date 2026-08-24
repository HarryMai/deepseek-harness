/** Custom Configuration settings section for user-managed MCP servers. */

import { useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { argumentsFromText, serverIssue, type McpSettingsFace } from './settings.ts'
import type { McpConnectionTestState, McpJsonImportResult, McpServerIssue } from './settings.ts'
import css from './McpSettingsSection.module.css'

/** Dependencies supplied by the `settings.section` slot registration. */
export interface McpSettingsSectionInjected extends McpSettingsFace {}

/** Full slot component props. */
export type McpSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.mcp'>
  & InjectFace<McpSettingsSectionInjected>

/** Resolve one Host loading condition to the string rendered beside the record. */
function issueText(issue: McpServerIssue | undefined, t: McpSettingsSectionProps['t']): string {
  switch (issue) {
    case undefined: return t('recordReady')
    case 'disabled': return t('recordDisabled')
    case 'incomplete': return t('recordIncomplete')
    case 'invalid-server-name': return t('invalidServerName')
    case 'invalid-url': return t('invalidUrl')
    case 'duplicate-server-name': return t('duplicateServerName')
  }
}

/** Resolve a one-shot probe outcome to a localized, non-persistent status. */
function testText(test: McpConnectionTestState, t: McpSettingsSectionProps['t']): string {
  switch (test.status) {
    case 'testing': return t('testingConnection')
    case 'success': return t('testSuccess', { count: test.toolCount })
    case 'failure':
      switch (test.reason) {
        case 'invalid-configuration': return t('testInvalidConfiguration')
        case 'connection-failed': return t('testConnectionFailed')
        case 'timed-out': return t('testTimedOut')
        case 'cancelled': return t('testCancelled')
        case 'unavailable': return t('testUnavailable')
      }
  }
}

/** Resolve a JSON import result to feedback beside its paste area. */
function importText(result: McpJsonImportResult, t: McpSettingsSectionProps['t']): string {
  if (result.ok) return t('importSucceeded', { count: result.count })
  switch (result.reason) {
    case 'invalid-json': return t('importInvalidJson')
    case 'invalid-root': return t('importInvalidRoot')
    case 'invalid-server': return t('importInvalidServer')
    case 'unsupported-fields': return t('importUnsupportedFields')
  }
}

/**
 * Render the Settings top-level Custom Configuration page.
 *
 * @param props - slot runtime, localized copy, saved snapshot, and staged-edit actions.
 * @returns the section element or an availability state.
 */
export function McpSettingsSection(props: McpSettingsSectionProps): ReactNode {
  const state = props.useMcpSettings(snapshot => snapshot)
  const { t } = props
  const [showImporter, setShowImporter] = useState(false)
  const [importValue, setImportValue] = useState('')
  const [importResult, setImportResult] = useState<McpJsonImportResult | undefined>()
  if (state.status === 'loading') return <p className={css.status}>{t('loading')}</p>
  if (state.status === 'unavailable') return <p className={css.status}>{t('unavailable')}</p>

  const disabled = !state.writable || state.saving
  const records = Object.entries(state.settings.servers)
  const nameCounts = new Map<string, number>()
  for (const [, server] of records) {
    if (!server.enabled) continue
    const name = server.serverName.trim()
    if (name.length > 0) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }
  return (
    <section className={css.section} aria-busy={state.saving}>
      <header className={css.header}>
        <h2>{t('title')}</h2>
        <p>{t('intro')}</p>
      </header>
      {!state.writable ? <p className={css.readOnly} role="status">{t('readOnly')}</p> : null}
      <label className={css.master}>
        <input
          type="checkbox"
          checked={state.settings.enabled}
          disabled={disabled}
          onChange={(event) => { props.setEnabled(event.currentTarget.checked) }}
        />
        <span>{t('masterLabel')}</span>
      </label>
      <p className={css.masterDescription} data-enabled={state.settings.enabled ? 'true' : 'false'}>
        {t(state.settings.enabled ? 'enabledDescription' : 'disabledDescription')}
      </p>

      <div className={css.serverHeader}>
        <h3>{t('servers')}</h3>
        <span className={css.serverActions}>
          <button
            type="button"
            className={css.import}
            disabled={disabled}
            onClick={() => {
              setShowImporter(open => !open)
              setImportResult(undefined)
            }}
          >
            {t('importJson')}
          </button>
          <button type="button" className={css.add} disabled={disabled} onClick={props.addServer}>{t('addServer')}</button>
        </span>
      </div>
      {showImporter ? (
        <div className={css.importPanel}>
          <label className={css.field} htmlFor="mcp-json-import">
            <span>{t('importJsonLabel')}</span>
            <textarea
              id="mcp-json-import"
              rows={8}
              value={importValue}
              disabled={disabled}
              aria-describedby="mcp-json-import-hint"
              onChange={(event) => {
                setImportValue(event.currentTarget.value)
                setImportResult(undefined)
              }}
            />
          </label>
          <small id="mcp-json-import-hint">{t('importJsonHint')}</small>
          {importResult === undefined ? null : (
            <p
              className={css.importStatus}
              data-success={importResult.ok ? 'true' : 'false'}
              role="status"
            >
              {importText(importResult, t)}
            </p>
          )}
          <span className={css.actions}>
            <button
              type="button"
              className={css.discard}
              disabled={disabled}
              onClick={() => {
                setShowImporter(false)
                setImportValue('')
                setImportResult(undefined)
              }}
            >
              {t('importCancel')}
            </button>
            <button
              type="button"
              className={css.save}
              disabled={disabled || importValue.trim().length === 0}
              onClick={() => {
                const result = props.importJson(importValue)
                setImportResult(result)
                if (result.ok) setImportValue('')
              }}
            >
              {t('importConfirm')}
            </button>
          </span>
        </div>
      ) : null}
      {records.length === 0 ? <p className={css.empty}>{t('empty')}</p> : null}
      <div className={css.records}>
        {records.map(([id, server], index) => {
          const issue = serverIssue(server, (nameCounts.get(server.serverName.trim()) ?? 0) > 1)
          const test = state.tests[id]
          const recordLabel = `${t('serverTitle')} ${String(index + 1)}`
          const fieldId = `mcp-server-${encodeURIComponent(id)}`
          return (
            <article className={css.card} key={id} data-server-id={id}>
              <div className={css.cardHeader}>
                <h4>{recordLabel}</h4>
                <span className={css.cardActions}>
                  <label className={css.recordEnabled}>
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      disabled={disabled}
                      onChange={(event) => { props.editServer(id, { enabled: event.currentTarget.checked }) }}
                    />
                    <span>{t('recordEnabled')}</span>
                  </label>
                  <button
                    type="button"
                    className={css.test}
                    disabled={disabled || test?.status === 'testing'}
                    onClick={() => { props.testServer(id) }}
                  >
                    {t(test?.status === 'testing' ? 'testingConnection' : 'testConnection')}
                  </button>
                  <button
                    type="button"
                    className={css.remove}
                    disabled={disabled}
                    aria-label={`${t('removeServer')}: ${server.serverName || recordLabel}`}
                    onClick={() => { props.removeServer(id) }}
                  >
                    {t('removeServer')}
                  </button>
                </span>
              </div>
              <div className={css.fields}>
                <div className={css.field}>
                  <label htmlFor={`${fieldId}-transport`}>{t('transport')}</label>
                  <select
                    id={`${fieldId}-transport`}
                    value={server.transport}
                    disabled={disabled}
                    onChange={(event) => {
                      props.editServer(id, { transport: event.currentTarget.value as typeof server.transport })
                    }}
                  >
                    <option value="stdio">{t('stdio')}</option>
                    <option value="streamable-http">{t('streamableHttp')}</option>
                  </select>
                </div>
                <div className={css.field}>
                  <label htmlFor={`${fieldId}-name`}>{t('serverName')}</label>
                  <input
                    id={`${fieldId}-name`}
                    value={server.serverName}
                    disabled={disabled}
                    onChange={(event) => { props.editServer(id, { serverName: event.currentTarget.value }) }}
                  />
                </div>
                {server.transport === 'stdio' ? (
                  <>
                    <div className={css.field}>
                      <label htmlFor={`${fieldId}-command`}>{t('command')}</label>
                      <input
                        id={`${fieldId}-command`}
                        aria-describedby={`${fieldId}-command-hint`}
                        value={server.command}
                        disabled={disabled}
                        onChange={(event) => { props.editServer(id, { command: event.currentTarget.value }) }}
                      />
                      <small id={`${fieldId}-command-hint`}>{t('commandHint')}</small>
                    </div>
                    <div className={css.field}>
                      <label htmlFor={`${fieldId}-arguments`}>{t('arguments')}</label>
                      <textarea
                        id={`${fieldId}-arguments`}
                        aria-describedby={`${fieldId}-arguments-hint`}
                        value={server.args.join('\n')}
                        disabled={disabled}
                        rows={3}
                        onChange={(event) => { props.editServer(id, { args: argumentsFromText(event.currentTarget.value) }) }}
                      />
                      <small id={`${fieldId}-arguments-hint`}>{t('argumentsHint')}</small>
                    </div>
                    <div className={css.field}>
                      <label htmlFor={`${fieldId}-cwd`}>{t('cwd')}</label>
                      <input
                        id={`${fieldId}-cwd`}
                        aria-describedby={`${fieldId}-cwd-hint`}
                        value={server.cwd}
                        disabled={disabled}
                        onChange={(event) => { props.editServer(id, { cwd: event.currentTarget.value }) }}
                      />
                      <small id={`${fieldId}-cwd-hint`}>{t('cwdHint')}</small>
                    </div>
                  </>
                ) : (
                  <div className={css.field}>
                    <label htmlFor={`${fieldId}-url`}>{t('url')}</label>
                    <input
                      id={`${fieldId}-url`}
                      type="url"
                      value={server.url}
                      disabled={disabled}
                      onChange={(event) => { props.editServer(id, { url: event.currentTarget.value }) }}
                    />
                  </div>
                )}
              </div>
              <p className={css.recordStatus} data-ready={issue === undefined ? 'true' : 'false'} role="status">
                {issueText(issue, t)}
              </p>
              {test === undefined ? null : (
                <p
                  className={css.testStatus}
                  data-status={test.status}
                  role="status"
                >
                  {testText(test, t)}
                </p>
              )}
            </article>
          )
        })}
      </div>

      <footer className={css.footer}>
        {state.dirty ? <span className={css.unsaved}>{t('unsaved')}</span> : null}
        {state.failed ? <p className={css.failed} role="status">{t('saveFailed')}</p> : null}
        <span className={css.actions}>
          <button type="button" className={css.discard} disabled={!state.dirty || state.saving} onClick={props.discard}>
            {t('discard')}
          </button>
          <button
            type="button"
            className={css.save}
            disabled={!state.dirty || disabled}
            onClick={props.save}
          >
            {t(state.saving ? 'saving' : 'save')}
          </button>
        </span>
      </footer>
    </section>
  )
}
