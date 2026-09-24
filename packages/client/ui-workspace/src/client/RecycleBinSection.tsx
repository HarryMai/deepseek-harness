/** Settings section for recovering or permanently clearing archived Sessions. */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button, IconRefreshOutlineMedium, IconTrashOutlineMedium, RiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RecycleBinSettingsFace } from './recycle-bin-settings.ts'
import css from './RecycleBinSection.module.css'

/** Actions injected beside the reactive recycle-bin settings state. */
export interface RecycleBinSectionInjected extends RecycleBinSettingsFace {
  /** Restore the selected active recycle-bin Sessions. */
  restoreArchivedSessions(sessionIds: readonly SessionId[]): Promise<void>
  /** Empty every active recycle-bin entry. */
  clearRecycleBin(): Promise<void>
}

/** Full slot component props. */
export type RecycleBinSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.recycleBin'>
  & InjectFace<RecycleBinSectionInjected>

type PendingAction =
  | { readonly kind: 'restore'; readonly sessionIds: readonly SessionId[] }
  | { readonly kind: 'clear' }

/** Render a local time when the durable archive timestamp parses successfully. */
function archiveTime(archivedAt: string): string {
  const date = new Date(archivedAt)
  return Number.isNaN(date.getTime()) ? archivedAt : date.toLocaleString()
}

/**
 * Render the settings-page recycle bin with confirmation-gated recovery and clearing.
 * @param props - runtime feeds, locale copy, settings state, and Host actions.
 * @returns the section element or a settings availability state.
 */
export function RecycleBinSection(props: RecycleBinSectionProps): ReactNode {
  const settings = props.useRecycleBinSettings(snapshot => snapshot)
  const workspaces = props.useWorkspaces(snapshot => snapshot)
  const sessions = props.useSessions(snapshot => snapshot)
  const [retentionDraft, setRetentionDraft] = useState(String(settings.retentionDays))
  const [retentionInvalid, setRetentionInvalid] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<SessionId>>(new Set())
  const [pending, setPending] = useState<PendingAction>()
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)

  useEffect(() => {
    setRetentionDraft(String(settings.retentionDays))
    setRetentionInvalid(false)
  }, [settings.retentionDays])

  const entries = useMemo(() => workspaces.recycleBinEntries.map(entry => ({
    entry,
    title: sessions.byId[entry.sessionId]?.displayTitle ?? String(entry.sessionId),
  })), [sessions.byId, workspaces.recycleBinEntries])
  const selectedEntries = entries.filter(({ entry }) => selected.has(entry.sessionId))
  const allSelected = entries.length > 0 && selectedEntries.length === entries.length
  const { t } = props

  if (settings.status === 'loading') return <p className={css.status}>{t('loading')}</p>
  if (settings.status === 'unavailable') return <p className={css.status}>{t('unavailable')}</p>

  const closeConfirmation = (): void => {
    if (submitting) return
    setPending(undefined)
    setAcknowledged(false)
    setActionFailed(false)
  }
  const requestRestore = (sessionIds: readonly SessionId[]): void => {
    if (sessionIds.length === 0 || submitting) return
    setPending({ kind: 'restore', sessionIds })
    setAcknowledged(false)
    setActionFailed(false)
  }
  const requestClear = (): void => {
    if (entries.length === 0 || submitting) return
    setPending({ kind: 'clear' })
    setAcknowledged(false)
    setActionFailed(false)
  }
  const confirm = async (): Promise<void> => {
    const action = pending
    if (action === undefined || submitting) return
    setSubmitting(true)
    setActionFailed(false)
    try {
      if (action.kind === 'restore') {
        await props.restoreArchivedSessions(action.sessionIds)
        setSelected((current) => {
          const next = new Set(current)
          for (const sessionId of action.sessionIds) next.delete(sessionId)
          return next
        })
      } else {
        await props.clearRecycleBin()
        setSelected(new Set())
      }
      setPending(undefined)
      setAcknowledged(false)
    } catch {
      setActionFailed(true)
    }
    setSubmitting(false)
  }
  const saveRetention = (): void => {
    const value = Number(retentionDraft)
    if (!Number.isSafeInteger(value) || value < 1) {
      setRetentionInvalid(true)
      return
    }
    setRetentionInvalid(false)
    void props.saveRetentionDays(value)
  }
  const toggleAll = (checked: boolean): void => {
    setSelected((current) => {
      const next = new Set(current)
      for (const { entry } of entries) {
        if (checked) next.add(entry.sessionId)
        else next.delete(entry.sessionId)
      }
      return next
    })
  }
  const toggleOne = (sessionId: SessionId, checked: boolean): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(sessionId)
      else next.delete(sessionId)
      return next
    })
  }
  const isRestore = pending?.kind === 'restore'
  const confirmationDescription = actionFailed
    ? t('operationFailed')
    : isRestore ? t('restoreDescription') : t('clearDescription')

  return (
    <section className={css.section} aria-busy={settings.saving || submitting}>
      <header className={css.header}>
        <h2>{t('title')}</h2>
      </header>
      <div className={css.retention}>
        <label className={css.field} htmlFor="recycle-bin-retention-days">
          <span>{t('retentionLabel')}</span>
          <input
            id="recycle-bin-retention-days"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={retentionDraft}
            disabled={!settings.writable || settings.saving}
            onChange={(event) => {
              setRetentionDraft(event.currentTarget.value)
              setRetentionInvalid(false)
            }}
          />
        </label>
        <Button variant="outline" onClick={saveRetention} disabled={!settings.writable || settings.saving}>
          {t('retentionSave')}
        </Button>
      </div>
      {retentionInvalid ? <p className={css.failure} role="status">{t('retentionInvalid')}</p> : null}
      {settings.failed ? <p className={css.failure} role="status">{t('retentionFailed')}</p> : null}
      {!settings.writable ? <p className={css.status} role="status">{t('readOnly')}</p> : null}

      <div className={css.toolbar}>
        <label className={css.selection}>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={entries.length === 0 || submitting}
            onChange={(event) => { toggleAll(event.currentTarget.checked) }}
          />
          <span>{t('selectAll')}</span>
        </label>
        <span className={css.actions}>
          <Button
            variant="outline"
            icon={<IconRefreshOutlineMedium />}
            disabled={selectedEntries.length === 0 || submitting}
            onClick={() => { requestRestore(selectedEntries.map(({ entry }) => entry.sessionId)) }}
          >
            {t('restoreSelected', { count: selectedEntries.length })}
          </Button>
          <Button
            variant="outline"
            className={css.dangerButton}
            icon={<IconTrashOutlineMedium />}
            disabled={entries.length === 0 || submitting}
            onClick={requestClear}
          >
            {t('clearAll')}
          </Button>
        </span>
      </div>

      {entries.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
        <div className={css.list} role="list">
          {entries.map(({ entry, title }) => (
            <div className={css.row} role="listitem" key={entry.sessionId} data-session-id={entry.sessionId}>
              <input
                aria-label={title}
                type="checkbox"
                checked={selected.has(entry.sessionId)}
                disabled={submitting}
                onChange={(event) => { toggleOne(entry.sessionId, event.currentTarget.checked) }}
              />
              <div className={css.session}>
                <strong>{title}</strong>
                <span>{t('archivedAt', { time: archiveTime(entry.archivedAt) })}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                icon={<IconRefreshOutlineMedium />}
                disabled={submitting}
                onClick={() => { requestRestore([entry.sessionId]) }}
              >
                {t('restoreOne')}
              </Button>
            </div>
          ))}
        </div>
      )}

      <RiskConfirmation
        open={pending !== undefined}
        title={isRestore ? t('restoreTitle') : t('clearTitle')}
        description={confirmationDescription}
        acknowledgeLabel={isRestore ? t('restoreAcknowledgement') : t('clearAcknowledgement')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        confirmLabel={isRestore ? t('restoreConfirm') : t('clearConfirm')}
        acknowledged={acknowledged}
        disabled={submitting}
        onAcknowledgedChange={setAcknowledged}
        onCancel={closeConfirmation}
        onConfirm={() => { void confirm() }}
      />
    </section>
  )
}
