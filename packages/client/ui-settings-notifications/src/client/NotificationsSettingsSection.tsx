/** Custom Configuration panel for personal mobile push notifications. */

import { useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  channelIssue,
  type BarkNotificationLevel,
  type NotificationChannelIssue,
  type NotificationEventKind,
  type PushProviderType,
} from '../types.ts'
import type { ChannelTestState, NotificationSettingsFace } from './settings.ts'
import type { NotificationSettingsKey } from './locales.ts'
import css from './NotificationsSettingsSection.module.css'

/** Dependencies supplied by the `settings.custom-config.item` slot registration. */
export interface NotificationsSettingsSectionInjected extends NotificationSettingsFace {}

/** Full slot component props. */
export type NotificationsSettingsSectionProps =
  PropsRuntime<'settings.custom-config.item'>
  & PropsLocale<'settings.customerNotifications'>
  & InjectFace<NotificationsSettingsSectionInjected>

const EVENT_ROWS: readonly {
  readonly key: NotificationEventKind
  readonly titleKey: NotificationSettingsKey
  readonly descKey: NotificationSettingsKey
}[] = [
  { key: 'approvalRequired', titleKey: 'eventApprovalTitle', descKey: 'eventApprovalDesc' },
  { key: 'manualActionRequired', titleKey: 'eventManualActionTitle', descKey: 'eventManualActionDesc' },
  { key: 'passiveInterruption', titleKey: 'eventPassiveInterruptionTitle', descKey: 'eventPassiveInterruptionDesc' },
  { key: 'taskCompleted', titleKey: 'eventTaskCompletedTitle', descKey: 'eventTaskCompletedDesc' },
]

function issueMessage(
  issue: NotificationChannelIssue | undefined,
  masterEnabled: boolean,
  t: NotificationsSettingsSectionProps['t'],
): string {
  switch (issue) {
    case undefined: return t(masterEnabled ? 'statusReadyActive' : 'statusReady')
    case 'disabled': return t('statusDisabled')
    case 'missing-server-url': return t('statusMissingServerUrl')
    case 'invalid-server-url': return t('statusInvalidServerUrl')
    case 'missing-device-key': return t('statusMissingDeviceKey')
    case 'unsupported-provider': return t('statusUnsupportedProvider')
  }
}

function testMessage(
  test: ChannelTestState,
  t: NotificationsSettingsSectionProps['t'],
): string {
  switch (test.status) {
    case 'testing': return t('testingPush')
    case 'success': return t('testSuccess')
    case 'failure':
      switch (test.reason) {
        case 'invalid-configuration': return t('testInvalidConfiguration')
        case 'unsupported-provider': return t('testUnsupportedProvider')
        case 'http-error': return t('testHttpError', { status: test.statusCode ?? 0 })
        case 'request-failed': return t('testRequestFailed')
        case 'timed-out': return t('testTimedOut')
        case 'cancelled': return t('testCancelled')
        case 'unavailable': return t('testUnavailable')
      }
  }
}

/**
 * Render the mobile push notification configuration panel inside Settings -> Custom Configuration.
 *
 * @param props - slot runtime, localized dictionary binding, snapshot store, and editor actions.
 * @returns the rendered notification settings panel or availability state.
 */
export function NotificationsSettingsSection(props: NotificationsSettingsSectionProps): ReactNode {
  const state = props.useNotificationSettings(snapshot => snapshot)
  const { t } = props
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({})

  if (state.status === 'loading') return <p className={css.status}>{t('loading')}</p>
  if (state.status === 'unavailable') return <p className={css.status}>{t('unavailable')}</p>

  const disabled = !state.writable || state.saving
  const channels = Object.entries(state.settings.channels)

  return (
    <section className={css.section} aria-busy={state.saving}>
      <header className={css.header}>
        <h3>{t('title')}</h3>
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

      <div className={css.panel}>
        <div className={css.groupHeader}>
          <h4>{t('triggersHeading')}</h4>
        </div>
        <p className={css.groupHint}>{t('triggersHint')}</p>
        <div className={css.triggerList}>
          {EVENT_ROWS.map(row => (
            <label className={css.triggerRow} key={row.key}>
              <input
                type="checkbox"
                checked={state.settings.events[row.key]}
                disabled={disabled}
                onChange={(event) => { props.setEventEnabled(row.key, event.currentTarget.checked) }}
              />
              <span className={css.triggerText}>
                <span className={css.triggerTitle}>{t(row.titleKey)}</span>
                <span className={css.triggerDesc}>{t(row.descKey)}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className={css.groupHeader}>
        <h4>{t('channelsHeading')}</h4>
        <button
          type="button"
          className={css.add}
          disabled={disabled}
          onClick={props.addChannel}
        >
          {t('addChannel')}
        </button>
      </div>
      <p className={css.groupHint}>{t('channelsHint')}</p>

      {channels.length === 0 ? <p className={css.empty}>{t('emptyChannels')}</p> : null}

      <div className={css.channels}>
        {channels.map(([id, channel], index) => {
          const issue = channelIssue(channel, true)
          const test = state.tests[id]
          const fieldId = `customer-notify-${encodeURIComponent(id)}`
          const cardTitle = channel.name.trim() || `${t('channelTitle')} ${String(index + 1)}`
          const revealed = revealedKeys[id] === true
          return (
            <article className={css.card} key={id} data-channel-id={id}>
              <div className={css.cardHeader}>
                <h4>{cardTitle}</h4>
                <span className={css.cardActions}>
                  <label className={css.channelEnabled}>
                    <input
                      type="checkbox"
                      checked={channel.enabled}
                      disabled={disabled}
                      onChange={(event) => { props.editChannel(id, { enabled: event.currentTarget.checked }) }}
                    />
                    <span>{t('channelEnabled')}</span>
                  </label>
                  <button
                    type="button"
                    className={css.test}
                    disabled={disabled || test?.status === 'testing'}
                    onClick={() => { props.testChannel(id) }}
                  >
                    {t(test?.status === 'testing' ? 'testingPush' : 'testPush')}
                  </button>
                  <button
                    type="button"
                    className={css.remove}
                    disabled={disabled}
                    aria-label={`${t('removeChannel')}: ${cardTitle}`}
                    onClick={() => {
                      setRevealedKeys(({ [id]: _removed, ...rest }) => rest)
                      props.removeChannel(id)
                    }}
                  >
                    {t('removeChannel')}
                  </button>
                </span>
              </div>

              <div className={css.fields}>
                <div className={css.field}>
                  <label htmlFor={`${fieldId}-provider`}>{t('providerLabel')}</label>
                  <select
                    id={`${fieldId}-provider`}
                    aria-describedby={`${fieldId}-provider-hint`}
                    value={channel.provider}
                    disabled={disabled}
                    onChange={(event) => {
                      props.editChannel(id, { provider: event.currentTarget.value as PushProviderType })
                    }}
                  >
                    <option value="bark">{t('providerBark')}</option>
                  </select>
                  <small id={`${fieldId}-provider-hint`}>{t('providerHint')}</small>
                </div>

                <div className={css.field}>
                  <label htmlFor={`${fieldId}-name`}>{t('nameLabel')}</label>
                  <input
                    id={`${fieldId}-name`}
                    placeholder={t('namePlaceholder')}
                    value={channel.name}
                    disabled={disabled}
                    onChange={(event) => { props.editChannel(id, { name: event.currentTarget.value }) }}
                  />
                </div>

                <div className={`${css.field} ${css.fieldFull}`}>
                  <label htmlFor={`${fieldId}-url`}>{t('serverUrlLabel')}</label>
                  <input
                    id={`${fieldId}-url`}
                    type="url"
                    placeholder={t('serverUrlPlaceholder')}
                    aria-describedby={`${fieldId}-url-hint`}
                    value={channel.serverUrl}
                    disabled={disabled}
                    onChange={(event) => { props.editChannel(id, { serverUrl: event.currentTarget.value }) }}
                  />
                  <small id={`${fieldId}-url-hint`}>{t('serverUrlHint')}</small>
                </div>

                <div className={`${css.field} ${css.fieldFull}`}>
                  <label htmlFor={`${fieldId}-key`}>{t('deviceKeyLabel')}</label>
                  <div className={css.secretRow}>
                    <input
                      id={`${fieldId}-key`}
                      type={revealed ? 'text' : 'password'}
                      autoComplete="off"
                      placeholder={t('deviceKeyPlaceholder')}
                      aria-describedby={`${fieldId}-key-hint`}
                      value={channel.deviceKey}
                      disabled={disabled}
                      onChange={(event) => { props.editChannel(id, { deviceKey: event.currentTarget.value }) }}
                    />
                    <button
                      type="button"
                      className={css.toggleSecret}
                      disabled={disabled}
                      onClick={() => {
                        setRevealedKeys(previous => ({ ...previous, [id]: !revealed }))
                      }}
                    >
                      {t(revealed ? 'hideKey' : 'showKey')}
                    </button>
                  </div>
                  <small id={`${fieldId}-key-hint`}>{t('deviceKeyHint')}</small>
                </div>

                <div className={css.field}>
                  <label htmlFor={`${fieldId}-group`}>{t('groupLabel')}</label>
                  <input
                    id={`${fieldId}-group`}
                    placeholder={t('groupPlaceholder')}
                    value={channel.group}
                    disabled={disabled}
                    onChange={(event) => { props.editChannel(id, { group: event.currentTarget.value }) }}
                  />
                </div>

                <div className={css.field}>
                  <label htmlFor={`${fieldId}-sound`}>{t('soundLabel')}</label>
                  <input
                    id={`${fieldId}-sound`}
                    placeholder={t('soundPlaceholder')}
                    value={channel.sound}
                    disabled={disabled}
                    onChange={(event) => { props.editChannel(id, { sound: event.currentTarget.value }) }}
                  />
                </div>

                <div className={css.field}>
                  <label htmlFor={`${fieldId}-level`}>{t('levelLabel')}</label>
                  <select
                    id={`${fieldId}-level`}
                    value={channel.level}
                    disabled={disabled}
                    onChange={(event) => {
                      props.editChannel(id, { level: event.currentTarget.value as BarkNotificationLevel })
                    }}
                  >
                    <option value="">{t('levelAuto')}</option>
                    <option value="active">{t('levelActive')}</option>
                    <option value="timeSensitive">{t('levelTimeSensitive')}</option>
                    <option value="passive">{t('levelPassive')}</option>
                  </select>
                </div>
              </div>

              <p className={css.recordStatus} data-ready={issue === undefined ? 'true' : 'false'} role="status">
                {issueMessage(issue, state.settings.enabled, t)}
              </p>

              {test === undefined ? null : (
                <p className={css.testStatus} data-status={test.status} role="status">
                  {testMessage(test, t)}
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
          <button
            type="button"
            className={css.discard}
            disabled={!state.dirty || state.saving}
            onClick={props.discard}
          >
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
