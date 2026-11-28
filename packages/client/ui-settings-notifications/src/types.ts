/**
 * Browser-safe notification settings, provider vocabulary, and validation helpers.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-notifications/types
 */

/** Profile entry id and settings namespace for personal mobile notifications. */
export const NOTIFICATIONS_SETTINGS_NAMESPACE = 'customer-notifications'

/** Dedicated loopback-only Connection RPC channel for testing staged channels. */
export const NOTIFICATIONS_RPC_CHANNEL = '/customer-notifications'

/** Endpoint name that dispatches a one-shot test notification. */
export const NOTIFICATIONS_TEST_ENDPOINT = 'test'

/** Default per-request HTTP delivery timeout in milliseconds. */
export const DEFAULT_NOTIFICATION_TIMEOUT_MS = 10_000

/**
 * Supported mobile push provider identifiers.
 * Stage 1 ships Bark Server; future stages extend this union with Android, HarmonyOS, and Xiaomi adapters.
 */
export type PushProviderType = 'bark'

/** All currently supported push provider types. */
export const PUSH_PROVIDER_TYPES: readonly PushProviderType[] = ['bark']

/** Optional Bark urgency level override; empty string lets the event pick its default urgency. */
export type BarkNotificationLevel = '' | 'active' | 'timeSensitive' | 'passive'

/** All valid Bark notification level values. */
export const BARK_NOTIFICATION_LEVELS: readonly BarkNotificationLevel[] = ['', 'active', 'timeSensitive', 'passive']

/** The four runtime lifecycle triggers that can emit mobile push notifications. */
export type NotificationEventKind =
  | 'approvalRequired'
  | 'manualActionRequired'
  | 'passiveInterruption'
  | 'taskCompleted'

/** Toggle map selecting which lifecycle triggers send mobile notifications. */
export interface NotificationEventsConfig {
  /** Notify when task execution requires human privilege escalation or approval. */
  approvalRequired: boolean
  /** Notify when task execution requires human input, plan review, or manual action. */
  manualActionRequired: boolean
  /** Notify when a task is passively interrupted without explicit user cancellation. */
  passiveInterruption: boolean
  /** Notify when a task finishes normally. */
  taskCompleted: boolean
}

/** One persisted mobile push channel configuration. */
export interface NotificationChannelSettings {
  /** Whether this channel receives notifications while the master switch is enabled. */
  enabled: boolean
  /** Push backend identifier; extensible beyond Bark for future mobile platforms. */
  provider: PushProviderType
  /** Optional user-facing label (for example, device name). */
  name: string
  /** Push server base URL (for Bark, e.g. `https://api.day.app` or a self-hosted server). */
  serverUrl: string
  /** Target device key or push credential for the configured provider. */
  deviceKey: string
  /** Optional notification group name on the mobile device. */
  group: string
  /** Optional sound name supported by the provider (for Bark, e.g. `minuet`). */
  sound: string
  /** Optional urgency override; empty selects the event's automatic level. */
  level: BarkNotificationLevel
}

/** Complete persisted settings section for personal mobile notifications. */
export interface NotificationSettings {
  /** Master switch controlling whether any mobile push notification is dispatched. */
  enabled: boolean
  /** Per-trigger switches for the four task notification timings. */
  events: NotificationEventsConfig
  /** Configured mobile push channels keyed by stable local record id. */
  channels: Record<string, NotificationChannelSettings>
}

/** Validation state preventing a channel from dispatching notifications. */
export type NotificationChannelIssue =
  | 'disabled'
  | 'missing-server-url'
  | 'invalid-server-url'
  | 'missing-device-key'
  | 'unsupported-provider'

/** Stable failure reasons returned by push delivery and test probes. */
export type PushDeliveryFailureReason =
  | 'invalid-configuration'
  | 'unsupported-provider'
  | 'http-error'
  | 'request-failed'
  | 'timed-out'
  | 'cancelled'
  | 'unavailable'

/** Outcome of one push delivery or settings-page test notification. */
export type PushDeliveryResult =
  | { readonly ok: true; readonly statusCode?: number }
  | { readonly ok: false; readonly reason: PushDeliveryFailureReason; readonly statusCode?: number }

/** Concise push notification payload handed to a provider adapter. */
export interface PushMessage {
  /** Event classification (or `'test'` for a settings-page verification push). */
  readonly event: NotificationEventKind | 'test'
  /** Short notification title summarizing the reason. */
  readonly title: string
  /** Short notification body naming the reason and concise task/context label. */
  readonly body: string
  /** Default notification group when the channel does not specify one. */
  readonly defaultGroup: string
  /** Automatic urgency level used when the channel leaves `level` empty. */
  readonly defaultLevel: Exclude<BarkNotificationLevel, ''>
  /** Unix epoch milliseconds when the notification was created. */
  readonly timestamp: number
}

/** Default trigger switches: all four requested timings enabled once the user activates notifications. */
export const DEFAULT_NOTIFICATION_EVENTS: NotificationEventsConfig = {
  approvalRequired: true,
  manualActionRequired: true,
  passiveInterruption: true,
  taskCompleted: true,
}

/** Default persisted settings: dormant until configured and switched on by the user. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  events: { ...DEFAULT_NOTIFICATION_EVENTS },
  channels: {},
}

/** Default fields for a newly added Bark push channel (starts disabled until user opts in). */
export const DEFAULT_NOTIFICATION_CHANNEL: NotificationChannelSettings = {
  enabled: false,
  provider: 'bark',
  name: '',
  serverUrl: 'https://api.day.app',
  deviceKey: '',
  group: 'DSH',
  sound: '',
  level: '',
}

/**
 * Validate whether a string is a syntactically valid HTTP or HTTPS URL without NUL characters.
 *
 * @param raw - raw user-supplied URL string.
 * @returns true when the trimmed string parses as an `http:` or `https:` URL.
 */
export function isValidHttpUrl(raw: string): boolean {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.includes('\0')) return false
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch (_invalidUrl) {
    // Non-URL input is rejected by returning false to form and Host validators.
    return false
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:'
}

/**
 * Create a detached copy of one channel record.
 *
 * @param channel - source channel settings.
 * @returns an independent shallow clone.
 */
export function cloneNotificationChannel(channel: NotificationChannelSettings): NotificationChannelSettings {
  return { ...channel }
}

/**
 * Create a detached copy of the full notification settings object.
 *
 * @param settings - source settings value.
 * @returns an independent deep clone.
 */
export function cloneNotificationSettings(settings: NotificationSettings): NotificationSettings {
  return {
    enabled: settings.enabled,
    events: { ...settings.events },
    channels: Object.fromEntries(
      Object.entries(settings.channels).map(([id, channel]) => [id, cloneNotificationChannel(channel)]),
    ),
  }
}

/**
 * Normalize partial or older settings input into complete browser- and Host-safe defaults.
 *
 * @param value - optional raw settings snapshot.
 * @returns normalized settings object.
 */
export function normalizeNotificationSettings(value: Partial<NotificationSettings> | undefined): NotificationSettings {
  if (value === undefined) return cloneNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS)
  const rawEvents = value.events
  const events: NotificationEventsConfig = {
    approvalRequired: typeof rawEvents?.approvalRequired === 'boolean'
      ? rawEvents.approvalRequired
      : DEFAULT_NOTIFICATION_EVENTS.approvalRequired,
    manualActionRequired: typeof rawEvents?.manualActionRequired === 'boolean'
      ? rawEvents.manualActionRequired
      : DEFAULT_NOTIFICATION_EVENTS.manualActionRequired,
    passiveInterruption: typeof rawEvents?.passiveInterruption === 'boolean'
      ? rawEvents.passiveInterruption
      : DEFAULT_NOTIFICATION_EVENTS.passiveInterruption,
    taskCompleted: typeof rawEvents?.taskCompleted === 'boolean'
      ? rawEvents.taskCompleted
      : DEFAULT_NOTIFICATION_EVENTS.taskCompleted,
  }
  const channels: Record<string, NotificationChannelSettings> = {}
  if (value.channels !== undefined) {
    for (const [id, raw] of Object.entries(value.channels)) {
      const level: BarkNotificationLevel = raw.level === 'active'
        || raw.level === 'timeSensitive'
        || raw.level === 'passive'
        ? raw.level
        : ''
      channels[id] = {
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : false,
        provider: 'bark',
        name: typeof raw.name === 'string' ? raw.name : '',
        serverUrl: typeof raw.serverUrl === 'string' ? raw.serverUrl : '',
        deviceKey: typeof raw.deviceKey === 'string' ? raw.deviceKey : '',
        group: typeof raw.group === 'string' ? raw.group : 'DSH',
        sound: typeof raw.sound === 'string' ? raw.sound : '',
        level,
      }
    }
  }
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : false,
    events,
    channels,
  }
}

/**
 * Inspect one channel record and report the first condition that prevents delivery.
 *
 * @param channel - channel record to check.
 * @param requireEnabled - when true (default), a disabled channel returns `'disabled'`.
 * @returns the blocking validation issue, or `undefined` when the channel is ready to push.
 */
export function channelIssue(
  channel: NotificationChannelSettings,
  requireEnabled = true,
): NotificationChannelIssue | undefined {
  if (requireEnabled && !channel.enabled) return 'disabled'
  if (!PUSH_PROVIDER_TYPES.includes(channel.provider)) return 'unsupported-provider'
  const serverUrl = channel.serverUrl.trim()
  if (serverUrl.length === 0) return 'missing-server-url'
  if (!isValidHttpUrl(serverUrl)) return 'invalid-server-url'
  const deviceKey = channel.deviceKey.trim()
  if (deviceKey.length === 0 || deviceKey.includes('\0')) return 'missing-device-key'
  return undefined
}
