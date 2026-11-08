/** Request compatibility controls shared by custom-provider creation and editing. */

import { useId } from 'react'
import type { ReactNode } from 'react'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Draft values and actions for one provider's protocol-specific settings. */
interface RequestCompatibilityProps {
  api: string | undefined
  value: unknown
  disabled: boolean
  t: (key: ModelsKey) => string
  onChange: (value: Record<string, unknown>) => void
}

/**
 * Remove exposed compatibility fields that the selected protocol cannot consume.
 * @param api - the selected custom-provider protocol.
 * @param value - the provider's compatibility draft; other fields are preserved.
 * @returns a detached compatibility object for this protocol.
 */
export function requestCompatibilityFor(api: string | undefined, value: unknown): Record<string, unknown> {
  const compat = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...value as Record<string, unknown> }
    : {}
  if (api !== 'openai-completions') delete compat['maxTokensField']
  if (api !== 'openai-completions' && api !== 'openai-responses') delete compat['supportsDeveloperRole']
  return compat
}

/**
 * Render optional overrides; Automatic removes the user-layer field.
 * @param props - selected protocol, draft, localized copy, and draft setter.
 * @returns a collapsed compatibility group, or nothing for other protocols.
 */
export function RequestCompatibility(props: RequestCompatibilityProps): ReactNode {
  const id = useId()
  const { api, disabled, t } = props
  if (api !== 'openai-completions' && api !== 'openai-responses') return null
  const compat = requestCompatibilityFor(api, props.value)
  const developerRole = compat['supportsDeveloperRole']
  const maxTokensField = compat['maxTokensField']
  const change = (field: string, value: string | boolean | undefined): void => {
    const next = { ...compat }
    if (value === undefined) Reflect.deleteProperty(next, field)
    else next[field] = value
    props.onChange(next)
  }
  return (
    <details className={styles['customized']}>
      <summary className={styles['customizedSummary']}>{t('requestCompatibility')}</summary>
      <div className={styles['customizedBody']}>
        <p id={`${id}-hint`} className={styles['advancedHint']}>{t('compatibilityHint')}</p>
        <label className={styles['field']}>
          <span className={styles['fieldLabel']}>{t('developerRole')}</span>
          <select
            className={`${styles['input']} ${styles['selectInput']}`}
            value={developerRole === true ? 'true' : developerRole === false ? 'false' : ''}
            aria-label={t('developerRole')}
            aria-describedby={`${id}-hint ${id}-developer-hint`}
            disabled={disabled}
            onChange={(event) => { change('supportsDeveloperRole', event.target.value === '' ? undefined : event.target.value === 'true') }}
          >
            <option value="">{t('compatibilityAutomatic')}</option>
            <option value="true">{t('compatibilitySupported')}</option>
            <option value="false">{t('compatibilityUnsupported')}</option>
          </select>
          <span id={`${id}-developer-hint`} className={styles['advancedHint']}>{t('developerRoleHint')}</span>
        </label>
        {api === 'openai-completions'
          ? (
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('maxTokensField')}</span>
              <select
                className={`${styles['input']} ${styles['selectInput']}`}
                value={typeof maxTokensField === 'string' ? maxTokensField : ''}
                aria-label={t('maxTokensField')}
                aria-describedby={`${id}-hint`}
                disabled={disabled}
                onChange={(event) => { change('maxTokensField', event.target.value === '' ? undefined : event.target.value) }}
              >
                <option value="">{t('compatibilityAutomatic')}</option>
                <option value="max_completion_tokens">max_completion_tokens</option>
                <option value="max_tokens">max_tokens</option>
              </select>
            </label>
          )
          : null}
      </div>
    </details>
  )
}
