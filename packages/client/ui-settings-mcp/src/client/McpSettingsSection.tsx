/** Custom Configuration settings section for user-managed MCP servers. */

import { useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { serverIssue, type McpSettingsFace } from './settings.ts'
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
    case 'invalid-environment': return t('invalidEnvironment')
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

interface EnvironmentRow {
  key: string
  value: string
}

/** Render at least one editable row while keeping the persisted form a string map. */
function environmentRows(env: Record<string, string>): EnvironmentRow[] {
  const rows = Object.entries(env).map(([key, value]) => ({ key, value }))
  return rows.length === 0 ? [{ key: '', value: '' }] : rows
}

/** Convert editable rows to the object accepted by the Host and stdio transport. */
function environmentFromRows(rows: EnvironmentRow[]): Record<string, string> {
  return Object.fromEntries(rows.filter(row => row.key.length > 0).map(row => [row.key, row.value]))
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
  const [argumentDrafts, setArgumentDrafts] = useState<Record<string, string[]>>({})
  const [environmentDrafts, setEnvironmentDrafts] = useState<Record<string, EnvironmentRow[]>>({})
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
          const args = argumentDrafts[id] ?? (server.args.length === 0 ? [''] : server.args)
          const envRows = environmentDrafts[id] ?? environmentRows(server.env ?? {})
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
                    onClick={() => {
                      setArgumentDrafts(({ [id]: _removedArguments, ...rest }) => rest)
                      setEnvironmentDrafts(({ [id]: _removed, ...rest }) => rest)
                      props.removeServer(id)
                    }}
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
                    <div className={`${css.field} ${css.arrayField}`}>
                      <span>{t('arguments')}</span>
                      <div className={css.arrayRows}>
                        {args.map((argument, argumentIndex) => (
                          <div className={css.arrayRow} key={`${fieldId}-argument-${String(argumentIndex)}`}>
                            <input
                              aria-label={`${t('argument')} ${String(argumentIndex + 1)}`}
                              value={argument}
                              disabled={disabled}
                              onChange={(event) => {
                                const next = [...args]
                                next[argumentIndex] = event.currentTarget.value
                                setArgumentDrafts(previous => ({ ...previous, [id]: next }))
                                props.editServer(id, { args: next.filter(value => value.length > 0) })
                              }}
                            />
                            <button
                              type="button"
                              className={css.removeRow}
                              aria-label={`${t('removeArgument')} ${String(argumentIndex + 1)}`}
                              disabled={disabled}
                              onClick={() => {
                                const next = args.filter((_, rowIndex) => rowIndex !== argumentIndex)
                                const retained = next.length === 0 ? [''] : next
                                setArgumentDrafts(previous => ({ ...previous, [id]: retained }))
                                props.editServer(id, { args: retained.filter(value => value.length > 0) })
                              }}
                            >
                              {t('removeArgument')}
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={css.addRow}
                        disabled={disabled}
                        onClick={() => {
                          setArgumentDrafts(previous => ({ ...previous, [id]: [...args, ''] }))
                          props.editServer(id, { args: args.filter(value => value.length > 0) })
                        }}
                      >
                        {t('addArgument')}
                      </button>
                      <small id={`${fieldId}-arguments-hint`}>{t('argumentsHint')}</small>
                    </div>
                    <div className={`${css.field} ${css.arrayField}`}>
                      <span>{t('environment')}</span>
                      <div className={css.arrayRows}>
                        {envRows.map((row, rowIndex) => (
                          <div className={`${css.arrayRow} ${css.environmentRow}`} key={`${fieldId}-environment-${String(rowIndex)}`}>
                            <input
                              aria-label={`${t('environmentKey')} ${String(rowIndex + 1)}`}
                              placeholder={t('environmentKey')}
                              value={row.key}
                              disabled={disabled}
                              onChange={(event) => {
                                const next = envRows.map(value => ({ ...value }))
                                const current = next[rowIndex]
                                if (current === undefined) return
                                current.key = event.currentTarget.value
                                setEnvironmentDrafts(previous => ({ ...previous, [id]: next }))
                                props.editServer(id, { env: environmentFromRows(next) })
                              }}
                            />
                            <input
                              aria-label={`${t('environmentValue')} ${String(rowIndex + 1)}`}
                              placeholder={t('environmentValue')}
                              value={row.value}
                              disabled={disabled}
                              onChange={(event) => {
                                const next = envRows.map(value => ({ ...value }))
                                const current = next[rowIndex]
                                if (current === undefined) return
                                current.value = event.currentTarget.value
                                setEnvironmentDrafts(previous => ({ ...previous, [id]: next }))
                                props.editServer(id, { env: environmentFromRows(next) })
                              }}
                            />
                            <button
                              type="button"
                              className={css.removeRow}
                              aria-label={`${t('removeEnvironment')} ${String(rowIndex + 1)}`}
                              disabled={disabled}
                              onClick={() => {
                                const next = envRows.filter((_, currentIndex) => currentIndex !== rowIndex)
                                const retained = next.length === 0 ? [{ key: '', value: '' }] : next
                                setEnvironmentDrafts(previous => ({ ...previous, [id]: retained }))
                                props.editServer(id, { env: environmentFromRows(retained) })
                              }}
                            >
                              {t('removeEnvironment')}
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={css.addRow}
                        disabled={disabled}
                        onClick={() => {
                          setEnvironmentDrafts(previous => ({
                            ...previous,
                            [id]: [...envRows, { key: '', value: '' }],
                          }))
                        }}
                      >
                        {t('addEnvironment')}
                      </button>
                      <small>{t('environmentHint')}</small>
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
