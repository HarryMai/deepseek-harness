/**
 * Host Cordis plugin for personal mobile push notifications.
 *
 * Watches live approval requests, human-action prompts, non-user passive turn
 * interruptions, and normal task completions, and dispatches concise mobile push
 * messages through configured channels (Stage 1: Bark Server).
 *
 * @module @deepseek-ai/dsh-client-ui-settings-notifications
 */

import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-settings'
import type { ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
import type { AskUserQuestionRequestEvent } from '@deepseek-ai/dsh-user-questions/types'
import { PUSH_COPY } from './locales/push.ts'
import {
  buildApprovalMessage,
  buildManualActionMessage,
  buildPassiveInterruptionMessage,
  buildTaskCompletedMessage,
  buildTestPushMessage,
  classifyUserQuestionRequest,
  passiveInterruptionReason,
} from './messages.ts'
import { BarkPushAdapter } from './providers/bark.ts'
import { PushProviderRegistry, type PushChannelAdapter, type PushFetch } from './providers/types.ts'
import {
  BARK_NOTIFICATION_LEVELS,
  DEFAULT_NOTIFICATION_EVENTS,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_NOTIFICATION_TIMEOUT_MS,
  NOTIFICATIONS_RPC_CHANNEL,
  NOTIFICATIONS_SETTINGS_NAMESPACE,
  NOTIFICATIONS_TEST_ENDPOINT,
  PUSH_PROVIDER_TYPES,
  channelIssue,
  type NotificationChannelSettings,
  type NotificationEventKind,
  type NotificationEventsConfig,
  type NotificationSettings,
  type PushDeliveryResult,
  type PushMessage,
} from './types.ts'

export * from './types.ts'
export * from './messages.ts'
export * from './providers/types.ts'
export * from './providers/bark.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Personal custom mobile push notification service. */
    customerNotifications: CustomerNotificationsService
  }
}

const MAX_TIMEOUT_MS = 60_000
const CHANNEL_FIELDS = new Set([
  'enabled',
  'provider',
  'name',
  'serverUrl',
  'deviceKey',
  'group',
  'sound',
  'level',
])

const NotificationEventsSchema = z.object({
  approvalRequired: z.boolean().default(DEFAULT_NOTIFICATION_EVENTS.approvalRequired),
  manualActionRequired: z.boolean().default(DEFAULT_NOTIFICATION_EVENTS.manualActionRequired),
  passiveInterruption: z.boolean().default(DEFAULT_NOTIFICATION_EVENTS.passiveInterruption),
  taskCompleted: z.boolean().default(DEFAULT_NOTIFICATION_EVENTS.taskCompleted),
})

const NotificationChannelSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.union([...PUSH_PROVIDER_TYPES]).default('bark'),
  name: z.string().default(''),
  serverUrl: z.string().default('https://api.day.app'),
  deviceKey: z.string().default(''),
  group: z.string().default('DSH'),
  sound: z.string().default(''),
  level: z.union([...BARK_NOTIFICATION_LEVELS]).default(''),
})

/** Live profile configuration accepted by {@link CustomerNotificationsService}. */
export interface Config {
  /** Master switch controlling whether mobile notifications are sent. */
  enabled: Volatile<boolean>
  /** Per-request HTTP timeout in milliseconds. */
  timeoutMs: Volatile<number>
  /** Switches selecting which of the four task timings trigger push notifications. */
  events: Volatile<NotificationEventsConfig>
  /** Saved mobile push channels keyed by stable local record id. */
  channels: Volatile<Record<string, NotificationChannelSettings>>
}

/** Editable live configuration schema persisted through the active profile patch. */
export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_NOTIFICATION_SETTINGS.enabled).volatile(),
  timeoutMs: z.number().step(1).min(500).max(MAX_TIMEOUT_MS).default(DEFAULT_NOTIFICATION_TIMEOUT_MS).volatile(),
  events: NotificationEventsSchema.default({ ...DEFAULT_NOTIFICATION_EVENTS }).volatile(),
  channels: z.dict(NotificationChannelSchema).default({}).volatile(),
})

/** Optional test/runtime dependencies for {@link CustomerNotificationsService}. */
export interface CustomerNotificationsOptions {
  /** Custom fetch transport used by built-in adapters during tests. */
  readonly fetch?: PushFetch
}

/** Narrow plain JSON objects at the untrusted RPC boundary. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

/**
 * Decode and validate one channel record from an untrusted settings-page test RPC payload.
 *
 * @param payload - untrusted request body from the browser RPC call.
 * @returns validated channel settings ready for test delivery, or `undefined` when invalid.
 */
export function parseTestChannelPayload(payload: unknown): NotificationChannelSettings | undefined {
  if (!isPlainObject(payload) || !isPlainObject(payload.channel)) return undefined
  const raw = payload.channel
  if (Object.keys(raw).some(key => !CHANNEL_FIELDS.has(key))) return undefined
  if (typeof raw.enabled !== 'boolean'
    || raw.provider !== 'bark'
    || typeof raw.name !== 'string'
    || typeof raw.serverUrl !== 'string'
    || typeof raw.deviceKey !== 'string'
    || typeof raw.group !== 'string'
    || typeof raw.sound !== 'string'
    || (raw.level !== '' && raw.level !== 'active' && raw.level !== 'timeSensitive' && raw.level !== 'passive')) {
    return undefined
  }
  const channel: NotificationChannelSettings = {
    enabled: raw.enabled,
    provider: raw.provider,
    name: raw.name.trim(),
    serverUrl: raw.serverUrl.trim(),
    deviceKey: raw.deviceKey.trim(),
    group: raw.group.trim(),
    sound: raw.sound.trim(),
    level: raw.level,
  }
  return channelIssue(channel, false) === undefined ? channel : undefined
}

/**
 * Host service that listens to DSH task lifecycle events and dispatches concise
 * mobile push notifications through registered push provider adapters.
 */
export class CustomerNotificationsService extends Service {
  static Config = Config
  static inject: readonly string[] = []

  private readonly registry = new PushProviderRegistry()
  private readonly inFlight = new Set<Promise<void>>()
  private readonly lifetime = new AbortController()
  private readonly turnStepCounts = new Map<SessionId, Map<number, number>>()
  private readonly fetchImpl: PushFetch | undefined
  private stopped = false

  /**
   * @param ctx - Host Cordis context.
   * @param config - live volatile notification settings.
   * @param options - optional transport overrides for testing.
   */
  constructor(
    ctx: Context,
    private readonly config: Config,
    options: CustomerNotificationsOptions = {},
  ) {
    super(ctx, 'customerNotifications')
    this.fetchImpl = options.fetch
    this.registry.register(new BarkPushAdapter())
  }

  /**
   * Register an additional mobile push provider adapter (e.g. Android, HarmonyOS, Xiaomi)
   * tied to the caller's Cordis effect lifetime.
   *
   * @param adapter - push provider implementation.
   * @returns disposer that unregisters this adapter.
   */
  registerProvider(adapter: PushChannelAdapter): () => Promise<void> {
    const dispose = this.ctx.effect(
      () => this.registry.register(adapter),
      `customerNotifications.registerProvider(${adapter.provider})`,
    )
    return async () => { await Promise.resolve(dispose()) }
  }

  /**
   * Return currently registered mobile push provider identifiers.
   *
   * @returns sorted list of provider keys.
   */
  providers(): string[] {
    return this.registry.list()
  }

  /**
   * Send one test notification to a staged channel without saving or enabling it.
   *
   * @param channel - candidate channel settings.
   * @param signal - optional caller cancellation signal.
   * @returns browser-safe delivery outcome.
   */
  async testChannel(
    channel: NotificationChannelSettings,
    signal?: AbortSignal,
  ): Promise<PushDeliveryResult> {
    if (this.stopped) return { ok: false, reason: 'unavailable' }
    const adapter = this.registry.get(channel.provider)
    if (adapter === undefined) return { ok: false, reason: 'unsupported-provider' }
    if (adapter.validate(channel) !== undefined) return { ok: false, reason: 'invalid-configuration' }
    const combinedSignal = signal === undefined
      ? this.lifetime.signal
      : AbortSignal.any([signal, this.lifetime.signal])
    const message = buildTestPushMessage(channel.name)
    return adapter.send(channel, message, {
      timeoutMs: this.resolveTimeoutMs(),
      signal: combinedSignal,
      ...(this.fetchImpl === undefined ? {} : { fetch: this.fetchImpl }),
    })
  }

  /**
   * Wait for all currently tracked background notification deliveries to settle.
   * Primarily useful in deterministic tests and clean shutdown.
   *
   * @returns promise that resolves once no background push remains in flight.
   */
  async flush(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight])
    }
  }

  protected *[Service.init](): Generator<() => Promise<void>, void, void> {
    const ctx = this.ctx
    // Keep the custom settings form out of generic auto-generated settings cards.
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    })

    // Register loopback-only test push RPC channel when web Connection is available.
    ctx.inject(['connection'], (connectionCtx) => {
      connectionCtx.connection.rpc.handle(
        NOTIFICATIONS_RPC_CHANNEL,
        async (endpoint, payload, signal) => {
          if (endpoint !== NOTIFICATIONS_TEST_ENDPOINT) {
            return { ok: true, value: { ok: false, reason: 'unavailable' } satisfies PushDeliveryResult }
          }
          const channel = parseTestChannelPayload(payload)
          if (channel === undefined) {
            return { ok: true, value: { ok: false, reason: 'invalid-configuration' } satisfies PushDeliveryResult }
          }
          return { ok: true, value: await this.testChannel(channel, signal) }
        },
        { access: 'owner-loopback' },
      )
    })

    // Timing 1: Human privilege escalation / approval requests.
    // Waterfall observer: fires notification non-blocking and always delegates via next().
    ctx.on('approval/request', (request, next) => {
      this.onApprovalRequest(request)
      return next()
    }, { global: true, prepend: true })

    // Timing 1 (intent: 'approval') & Timing 2 (manual action / plan review / ask_user_question).
    // Waterfall observer: fires notification non-blocking and always delegates via next().
    ctx.on('user-questions/request', (request, next) => {
      this.onUserQuestionRequest(request)
      return next()
    }, { global: true, prepend: true })

    // Timing 3 (passive non-user interruption) & Timing 4 (normal task completion).
    ctx.on('session/event', (session, event) => {
      this.onSessionEvent(session, event)
    })

    ctx.on('session/disposed', (session) => {
      this.turnStepCounts.delete(session.id)
    })

    yield async () => {
      this.stopped = true
      this.lifetime.abort(new Error('customer-notifications service disposed'))
      this.turnStepCounts.clear()
      await this.flush()
    }
  }

  private onApprovalRequest(request: ApprovalRequestEvent): void {
    const taskLabel = this.sessionLabel(request.agent.session)
    this.notify('approvalRequired', buildApprovalMessage({
      taskLabel,
      toolName: request.toolName,
    }))
  }

  private onUserQuestionRequest(request: AskUserQuestionRequestEvent): void {
    const session = request.agent?.session
    const taskLabel = session === undefined ? undefined : this.sessionLabel(session)
    const kind = classifyUserQuestionRequest(request)
    if (kind === 'approval') {
      const subjectName = request.questions.find(item => item.intent?.kind === 'approval')?.intent
      const subject = subjectName?.kind === 'approval' ? subjectName.subject?.name : undefined
      this.notify('approvalRequired', buildApprovalMessage({
        ...(taskLabel === undefined ? {} : { taskLabel }),
        ...(subject === undefined ? {} : { subjectName: subject }),
      }))
      return
    }
    this.notify('manualActionRequired', buildManualActionMessage({
      ...(taskLabel === undefined ? {} : { taskLabel }),
      isPlanReview: kind === 'plan-review',
    }))
  }

  private onSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type === 'turn/start') {
      const turns = this.turnStepCounts.get(session.id) ?? new Map<number, number>()
      turns.set(event.data.turn, 0)
      this.turnStepCounts.set(session.id, turns)
      return
    }
    if (event.type === 'step/start') {
      const turns = this.turnStepCounts.get(session.id)
      if (turns !== undefined) {
        turns.set(event.data.turn, (turns.get(event.data.turn) ?? 0) + 1)
      }
      return
    }
    if (event.type !== 'turn/end') return

    const turns = this.turnStepCounts.get(session.id)
    const observedSteps = turns?.get(event.data.turn)
    turns?.delete(event.data.turn)
    if (turns !== undefined && turns.size === 0) this.turnStepCounts.delete(session.id)

    // Subagent turns are internal delegation work; only top-level sessions notify on turn completion/interruption.
    if (session.header.origin === 'subagent') return

    const reason = event.data.reason
    if (reason.kind === 'completed') {
      // Skip empty no-op turns (opened and immediately closed without running any model step).
      if (observedSteps === 0) return
      // Skip intermediate turns when follow-up or steering input is already queued to run next.
      const agent = this.ctx.get('agents')?.get(session.id)
      if (agent !== undefined && (agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)) return
      this.notify('taskCompleted', buildTaskCompletedMessage({
        taskLabel: this.sessionLabel(session),
      }))
      return
    }

    const interruption = passiveInterruptionReason(reason)
    if (interruption !== undefined) {
      this.notify('passiveInterruption', buildPassiveInterruptionMessage({
        reasonText: interruption,
        taskLabel: this.sessionLabel(session),
      }))
    }
  }

  private sessionLabel(session: Session): string {
    const title = this.ctx.get('sessionTitle')?.get(session)?.title.trim()
    if (title !== undefined && title.length > 0) return title
    return PUSH_COPY.formatSessionFallback(session.id.slice(0, 8))
  }

  private currentSettings(): NotificationSettings {
    return {
      enabled: this.config.enabled.get(),
      events: this.config.events.get(),
      channels: this.config.channels.get(),
    }
  }

  private resolveTimeoutMs(): number {
    const raw = this.config.timeoutMs.get()
    return Number.isFinite(raw) && raw >= 500 && raw <= MAX_TIMEOUT_MS
      ? raw
      : DEFAULT_NOTIFICATION_TIMEOUT_MS
  }

  private notify(kind: NotificationEventKind, message: PushMessage): void {
    if (this.stopped || this.ctx.fiber.uid === null) return
    const settings = this.currentSettings()
    if (!settings.enabled || !settings.events[kind]) return

    const targets = Object.entries(settings.channels).filter(([, channel]) => {
      if (!channel.enabled) return false
      const adapter = this.registry.get(channel.provider)
      return adapter !== undefined && adapter.validate(channel) === undefined
    })
    if (targets.length === 0) return

    const timeoutMs = this.resolveTimeoutMs()
    const run = this.deliverToTargets(targets, message, timeoutMs)
    this.inFlight.add(run)
    const cleanup = (): void => { this.inFlight.delete(run) }
    void run.then(cleanup, cleanup)
  }

  private async deliverToTargets(
    targets: readonly [string, NotificationChannelSettings][],
    message: PushMessage,
    timeoutMs: number,
  ): Promise<void> {
    await Promise.allSettled(targets.map(async ([id, channel]) => {
      const adapter = this.registry.get(channel.provider)
      if (adapter === undefined) return
      try {
        const result = await adapter.send(channel, message, {
          timeoutMs,
          signal: this.lifetime.signal,
          ...(this.fetchImpl === undefined ? {} : { fetch: this.fetchImpl }),
        })
        if (!result.ok && !this.stopped) {
          const statusPart = result.statusCode === undefined ? '' : ` (HTTP ${String(result.statusCode)})`
          this.ctx.logger.warn(
            `${NOTIFICATIONS_SETTINGS_NAMESPACE}: channel "${id}" (${channel.provider}) delivery failed: ${result.reason}${statusPart}`,
          )
        }
      } catch (error: unknown) {
        if (!this.stopped) {
          this.ctx.logger.warn(`${NOTIFICATIONS_SETTINGS_NAMESPACE}: unexpected delivery error on channel "${id}"`)
          this.ctx.logger.warn(error)
        }
      }
    }))
  }
}

/** Cordis plugin name used by Loader diagnostics. */
export const name = NOTIFICATIONS_SETTINGS_NAMESPACE

/** Cordis plugin entry point. */
export const apply = CustomerNotificationsService
