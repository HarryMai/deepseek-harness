/**
 * Browser-side staged editor for the Host-owned `customer-notifications` settings section.
 *
 * Manages local draft edits, validation feedback, loopback test-push requests,
 * and persistence through the shared `ConfigForm` surface.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_NOTIFICATION_CHANNEL,
  DEFAULT_NOTIFICATION_SETTINGS,
  channelIssue,
  cloneNotificationChannel,
  cloneNotificationSettings,
  normalizeNotificationSettings,
  type NotificationChannelSettings,
  type NotificationEventKind,
  type NotificationSettings,
  type PushDeliveryFailureReason,
  type PushDeliveryResult,
} from '../types.ts'

/** Transient state of a one-shot test notification for one staged channel. */
export type ChannelTestState =
  | { readonly status: 'testing' }
  | { readonly status: 'success' }
  | { readonly status: 'failure'; readonly reason: PushDeliveryFailureReason; readonly statusCode?: number }

/** Host-side adapter for sending one test push without saving the draft. */
export interface NotificationPushTester {
  /** Send one test push to the supplied staged channel. */
  test(channel: NotificationChannelSettings, signal: AbortSignal): Promise<PushDeliveryResult>
}

/** Browser state rendered by the notification settings panel. */
export interface NotificationSettingsState {
  /** Configuration-form availability state from the Host mirror. */
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** Whether this browser can persist settings to the Host. */
  readonly writable: boolean
  /** Current staged configuration, including unsaved edits. */
  readonly settings: NotificationSettings
  /** Whether local staged edits differ from the last Host-accepted value. */
  readonly dirty: boolean
  /** Whether a save operation is in flight. */
  readonly saving: boolean
  /** Whether the latest save failed to commit cleanly. */
  readonly failed: boolean
  /** Non-persistent test-push results keyed by channel id. */
  readonly tests: Readonly<Record<string, ChannelTestState>>
}

/** Slot-injected controller actions and snapshot store. */
export interface NotificationSettingsFace {
  /** Snapshot hooks bound by the UI renderer (`useNotificationSettings`). */
  readonly hooks: {
    readonly notificationSettings: SnapshotStore<NotificationSettingsState>
  }
  /** Toggle the master notification switch. */
  readonly setEnabled: (enabled: boolean) => void
  /** Toggle one of the four notification triggers. */
  readonly setEventEnabled: (event: NotificationEventKind, enabled: boolean) => void
  /** Append a new disabled Bark channel card. */
  readonly addChannel: () => void
  /** Remove one staged channel by id. */
  readonly removeChannel: (id: string) => void
  /** Patch editable fields on one staged channel. */
  readonly editChannel: (id: string, patch: Partial<NotificationChannelSettings>) => void
  /** Send a one-shot test notification using the current staged channel fields. */
  readonly testChannel: (id: string) => void
  /** Persist all staged notification settings to the Host profile patch. */
  readonly save: () => void
  /** Discard local edits and restore the latest Host-accepted settings. */
  readonly discard: () => void
}

const unavailablePushTester: NotificationPushTester = {
  test(): Promise<PushDeliveryResult> {
    return Promise.resolve({ ok: false, reason: 'unavailable' })
  },
}

function sameSettings(left: NotificationSettings, right: NotificationSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Staged settings controller synchronized with the Host `customer-notifications` form.
 */
export class NotificationSettingsController {
  /** Reactive UI snapshot store observed by {@link NotificationsSettingsSection}. */
  readonly store: SnapshotStore<NotificationSettingsState>
  private readonly form: ConfigForm<NotificationSettings>
  private readonly tester: NotificationPushTester
  private readonly unsubscribe: () => void
  private readonly testControllers = new Map<string, AbortController>()
  private readonly tests = new Map<string, ChannelTestState>()
  private committed: NotificationSettings = cloneNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS)
  private draft: NotificationSettings = cloneNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS)
  private dirty = false
  private saving = false
  private failed = false
  private nextId = 0

  /**
   * @param form - shared Host configuration form for `customer-notifications`.
   * @param tester - optional loopback test-push transport.
   */
  constructor(form: ConfigForm<NotificationSettings>, tester: NotificationPushTester = unavailablePushTester) {
    this.form = form
    this.tester = tester
    this.store = createSnapshotStore(this.project())
    this.unsubscribe = form.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Build the slot-injected face consumed by {@link NotificationsSettingsSection}.
   * @returns snapshot hook binding and action callbacks.
   */
  inject(): NotificationSettingsFace {
    return {
      hooks: { notificationSettings: this.store },
      setEnabled: (enabled) => { this.setEnabled(enabled) },
      setEventEnabled: (event, enabled) => { this.setEventEnabled(event, enabled) },
      addChannel: () => { this.addChannel() },
      removeChannel: (id) => { this.removeChannel(id) },
      editChannel: (id, patch) => { this.editChannel(id, patch) },
      testChannel: (id) => { void this.testChannel(id) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  /** Stop form subscriptions and abort every pending test push. */
  dispose(): void {
    this.unsubscribe()
    this.cancelAllTests()
  }

  /**
   * Toggle the master switch in the local draft.
   * @param enabled - desired master switch state.
   */
  setEnabled(enabled: boolean): void {
    if (this.draft.enabled === enabled) return
    this.draft = { ...this.draft, enabled }
    this.changed()
  }

  /**
   * Toggle one of the four notification trigger timings in the local draft.
   * @param event - lifecycle trigger identifier.
   * @param enabled - whether this trigger emits notifications.
   */
  setEventEnabled(event: NotificationEventKind, enabled: boolean): void {
    if (this.draft.events[event] === enabled) return
    this.draft = {
      ...this.draft,
      events: { ...this.draft.events, [event]: enabled },
    }
    this.changed()
  }

  /** Append a fresh disabled Bark channel record to the local draft. */
  addChannel(): void {
    let id: string
    do {
      this.nextId += 1
      id = `channel-${String(this.nextId)}`
    } while (Object.hasOwn(this.draft.channels, id))
    this.draft = {
      ...this.draft,
      channels: {
        ...this.draft.channels,
        [id]: cloneNotificationChannel(DEFAULT_NOTIFICATION_CHANNEL),
      },
    }
    this.changed()
  }

  /**
   * Remove one channel from the local draft and abort any in-flight test for it.
   * @param id - stable local channel identifier.
   */
  removeChannel(id: string): void {
    if (!Object.hasOwn(this.draft.channels, id)) return
    this.cancelTest(id)
    const { [id]: _removed, ...channels } = this.draft.channels
    this.draft = { ...this.draft, channels }
    this.changed()
  }

  /**
   * Update fields on one staged channel record.
   * @param id - stable local channel identifier.
   * @param patch - partial field updates applied to the channel draft.
   */
  editChannel(id: string, patch: Partial<NotificationChannelSettings>): void {
    const existing = this.draft.channels[id]
    if (existing === undefined) return
    this.cancelTest(id)
    this.draft = {
      ...this.draft,
      channels: {
        ...this.draft.channels,
        [id]: { ...existing, ...patch },
      },
    }
    this.changed()
  }

  /**
   * Send a one-shot test notification for one staged channel without saving.
   * @param id - stable local channel identifier.
   */
  async testChannel(id: string): Promise<void> {
    const channel = this.draft.channels[id]
    if (channel === undefined || this.testControllers.has(id)) return
    const issue = channelIssue(channel, false)
    if (issue !== undefined) {
      this.tests.set(id, {
        status: 'failure',
        reason: issue === 'unsupported-provider' ? 'unsupported-provider' : 'invalid-configuration',
      })
      this.publish()
      return
    }

    const signature = JSON.stringify(channel)
    const controller = new AbortController()
    this.testControllers.set(id, controller)
    this.tests.set(id, { status: 'testing' })
    this.publish()

    let result: PushDeliveryResult
    try {
      result = await this.tester.test(cloneNotificationChannel(channel), controller.signal)
    } catch (_testFailed) {
      // Translate thrown transport errors into localized browser-safe status values.
      result = controller.signal.aborted
        ? { ok: false, reason: 'cancelled' }
        : { ok: false, reason: 'request-failed' }
    }

    if (this.testControllers.get(id) !== controller
      || this.draft.channels[id] === undefined
      || JSON.stringify(this.draft.channels[id]) !== signature) {
      return
    }
    this.testControllers.delete(id)
    this.tests.set(
      id,
      result.ok
        ? { status: 'success' }
        : {
          status: 'failure',
          reason: result.reason,
          ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
        },
    )
    this.publish()
  }

  /** Discard staged changes and restore the latest Host-accepted snapshot. */
  discard(): void {
    if (!this.dirty && !this.failed) return
    this.cancelAllTests()
    this.draft = cloneNotificationSettings(this.committed)
    this.dirty = false
    this.failed = false
    this.publish()
  }

  /** Persist staged settings to the Host profile patch. */
  async save(): Promise<void> {
    const current = this.form.getSnapshot()
    if (!this.dirty || this.saving || current.status !== 'ready' || !current.writable) return
    const desired = cloneNotificationSettings(this.draft)
    this.saving = true
    this.failed = false
    this.publish()
    try {
      if (desired.enabled) {
        await this.form.set('events', desired.events)
        await this.form.set('channels', desired.channels)
        await this.form.set('enabled', true)
      } else {
        await this.form.set('enabled', false)
        await this.form.set('events', desired.events)
        await this.form.set('channels', desired.channels)
      }
    } catch (_saveFailed) {
      // Retain draft edits so the user can fix or retry after a rejected save.
      this.saving = false
      this.failed = true
      this.publish()
      return
    }

    const accepted = this.form.getSnapshot().value
    if (accepted !== undefined && sameSettings(normalizeNotificationSettings(accepted), desired)) {
      this.committed = cloneNotificationSettings(desired)
      this.draft = cloneNotificationSettings(desired)
      this.dirty = false
      this.failed = false
    } else {
      this.failed = true
    }
    this.saving = false
    this.publish()
  }

  private adopt(): void {
    const accepted = this.form.getSnapshot().value
    if (accepted !== undefined) {
      this.committed = normalizeNotificationSettings(accepted)
      if (!this.dirty && !this.saving) {
        this.cancelAllTests()
        this.draft = cloneNotificationSettings(this.committed)
      }
      this.dirty = !sameSettings(this.draft, this.committed)
    }
    this.publish()
  }

  private changed(): void {
    this.dirty = !sameSettings(this.draft, this.committed)
    this.failed = false
    this.publish()
  }

  private project(): NotificationSettingsState {
    const snapshot = this.form.getSnapshot()
    return {
      status: snapshot.status,
      writable: snapshot.writable,
      settings: cloneNotificationSettings(this.draft),
      dirty: this.dirty,
      saving: this.saving,
      failed: this.failed,
      tests: Object.fromEntries(this.tests),
    }
  }

  private publish(): void {
    this.store.set(this.project())
  }

  private cancelTest(id: string): void {
    this.testControllers.get(id)?.abort()
    this.testControllers.delete(id)
    this.tests.delete(id)
  }

  private cancelAllTests(): void {
    for (const controller of this.testControllers.values()) controller.abort()
    this.testControllers.clear()
    this.tests.clear()
  }
}
