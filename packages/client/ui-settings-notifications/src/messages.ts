/**
 * Concise push message formatters for the four task lifecycle triggers and test probes.
 *
 * Messages deliberately report only the push reason and a short task/action label,
 * omitting full conversation text, tool arguments, or error stack traces.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-notifications/messages
 */

import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import type { AskUserQuestionRequestEvent } from '@deepseek-ai/dsh-user-questions/types'
import { PUSH_COPY } from './locales/push.ts'
import type { PushMessage } from './types.ts'

const MAX_LABEL_CHARS = 60
const DEFAULT_GROUP = 'DSH'

/**
 * Collapse whitespace and bound a short label so mobile notifications stay concise.
 *
 * @param raw - optional raw text label.
 * @param fallback - fallback text used when `raw` normalizes to empty.
 * @returns single-line label bounded to the notification length budget.
 */
export function compactLabel(raw: string | undefined, fallback: string): string {
  const collapsed = (raw ?? '').replace(/\s+/gu, ' ').trim()
  if (collapsed.length === 0) return fallback
  if (collapsed.length <= MAX_LABEL_CHARS) return collapsed
  return `${collapsed.slice(0, MAX_LABEL_CHARS - 1)}…`
}

/**
 * Build a concise notification for human privilege escalation / approval requests.
 *
 * @param options - short task label and optional tool/subject name.
 * @returns concise push payload without command or transcript body details.
 */
export function buildApprovalMessage(options: {
  readonly taskLabel?: string
  readonly toolName?: string
  readonly subjectName?: string
  readonly timestamp?: number
}): PushMessage {
  const task = compactLabel(options.taskLabel, PUSH_COPY.fallbackTask)
  const target = compactLabel(options.toolName ?? options.subjectName, '')
  const reason = target.length > 0
    ? PUSH_COPY.approvalReasonWithTarget(target)
    : PUSH_COPY.approvalReasonGeneric
  return {
    event: 'approvalRequired',
    title: PUSH_COPY.approvalTitle,
    body: PUSH_COPY.formatBody(reason, task),
    defaultGroup: DEFAULT_GROUP,
    defaultLevel: 'timeSensitive',
    timestamp: options.timestamp ?? Date.now(),
  }
}

/**
 * Build a concise notification for human interaction / manual operation prompts.
 *
 * @param options - short task label and interaction subtype (`plan-review` vs general question).
 * @returns concise push payload without full question or plan body content.
 */
export function buildManualActionMessage(options: {
  readonly taskLabel?: string
  readonly isPlanReview?: boolean
  readonly timestamp?: number
}): PushMessage {
  const task = compactLabel(options.taskLabel, PUSH_COPY.fallbackTask)
  const reason = options.isPlanReview === true
    ? PUSH_COPY.manualActionReasonPlan
    : PUSH_COPY.manualActionReasonGeneral
  return {
    event: 'manualActionRequired',
    title: PUSH_COPY.manualActionTitle,
    body: PUSH_COPY.formatBody(reason, task),
    defaultGroup: DEFAULT_GROUP,
    defaultLevel: 'timeSensitive',
    timestamp: options.timestamp ?? Date.now(),
  }
}

/**
 * Classify whether a `user-questions/request` asks for privilege approval or general human action.
 *
 * @param request - live user-questions request payload.
 * @returns `'approval'` when any question declares an approval intent, `'plan-review'` for plan confirmation, else `'action'`.
 */
export function classifyUserQuestionRequest(
  request: AskUserQuestionRequestEvent,
): 'approval' | 'plan-review' | 'action' {
  for (const question of request.questions) {
    if (question.intent?.kind === 'approval') return 'approval'
  }
  for (const question of request.questions) {
    if (question.intent?.kind === 'plan-review') return 'plan-review'
  }
  return 'action'
}

/**
 * Resolve a short reason description for a non-user passive turn interruption,
 * or return `undefined` when the turn end is not a passive interruption.
 *
 * @param reason - durable `turn/end` reason.
 * @returns concise interruption reason, or `undefined` when excluded (completed, user cancel, disposed, forked).
 */
export function passiveInterruptionReason(reason: TurnEndReason): string | undefined {
  switch (reason.kind) {
    case 'error': {
      const code = reason.error.code
      return code && code !== 'UNKNOWN'
        ? PUSH_COPY.interruptionErrorWithCode(compactLabel(code, ''))
        : PUSH_COPY.interruptionError
    }
    case 'max-tokens':
      return PUSH_COPY.interruptionMaxTokens
    case 'blocked':
      return PUSH_COPY.interruptionBlocked
    case 'interrupted':
      return PUSH_COPY.interruptionUnexpected
    case 'aborted':
      switch (reason.reason.kind) {
        case 'user':
        case 'disposed':
          return undefined
        case 'hook':
          return PUSH_COPY.interruptionHook
        case 'parent':
          return PUSH_COPY.interruptionParent
        case 'legacy':
          return PUSH_COPY.interruptionLegacy
      }
    case 'completed':
    case 'forked':
      return undefined
    default:
      // Merge-extensible TurnEndReasonMap: ignore unknown plugin-defined variants by default.
      return undefined
  }
}

/**
 * Build a concise notification for non-user passive task interruption.
 *
 * @param options - concise interruption reason and task label.
 * @returns concise push payload without stack traces or verbose logs.
 */
export function buildPassiveInterruptionMessage(options: {
  readonly reasonText: string
  readonly taskLabel?: string
  readonly timestamp?: number
}): PushMessage {
  const task = compactLabel(options.taskLabel, PUSH_COPY.fallbackTask)
  return {
    event: 'passiveInterruption',
    title: PUSH_COPY.passiveInterruptionTitle,
    body: PUSH_COPY.formatBody(options.reasonText, task),
    defaultGroup: DEFAULT_GROUP,
    defaultLevel: 'timeSensitive',
    timestamp: options.timestamp ?? Date.now(),
  }
}

/**
 * Build a concise notification for normal task completion.
 *
 * @param options - short task label.
 * @returns concise push payload without full assistant reply text.
 */
export function buildTaskCompletedMessage(options: {
  readonly taskLabel?: string
  readonly timestamp?: number
}): PushMessage {
  const task = compactLabel(options.taskLabel, PUSH_COPY.fallbackTask)
  return {
    event: 'taskCompleted',
    title: PUSH_COPY.taskCompletedTitle,
    body: PUSH_COPY.formatBody(PUSH_COPY.taskCompletedReason, task),
    defaultGroup: DEFAULT_GROUP,
    defaultLevel: 'active',
    timestamp: options.timestamp ?? Date.now(),
  }
}

/**
 * Build a concise test notification sent from the settings UI.
 *
 * @param channelName - optional user-configured channel name.
 * @param timestamp - optional Unix epoch timestamp.
 * @returns concise test push payload.
 */
export function buildTestPushMessage(channelName?: string, timestamp?: number): PushMessage {
  const label = compactLabel(channelName, PUSH_COPY.fallbackChannel)
  return {
    event: 'test',
    title: PUSH_COPY.testTitle,
    body: PUSH_COPY.formatBody(PUSH_COPY.testReason, PUSH_COPY.testContent(label)),
    defaultGroup: DEFAULT_GROUP,
    defaultLevel: 'active',
    timestamp: timestamp ?? Date.now(),
  }
}
