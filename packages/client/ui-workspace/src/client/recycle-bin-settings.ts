/** Browser-side settings state for the Workspace recycle-bin retention. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Namespace shared with the Host Workspace registry. */
export const RECYCLE_BIN_SETTINGS_NAMESPACE = 'workspace-recycle-bin'

/** Browser projection of the persisted recycle-bin setting. */
export interface RecycleBinSettings {
  /** Number of whole days an archived Session remains recoverable. */
  retentionDays: number
}

/** Default value used until the Host supplies a resolved settings section. */
export const DEFAULT_RECYCLE_BIN_SETTINGS: RecycleBinSettings = { retentionDays: 30 }

/** Render-facing status of the recycle-bin retention preference. */
export interface RecycleBinSettingsState {
  /** Host settings availability. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Whether the backing settings document accepts writes. */
  writable: boolean
  /** Effective whole-day retention. */
  retentionDays: number
  /** A write is crossing the settings transport. */
  saving: boolean
  /** The most recent write did not become the Host-accepted value. */
  failed: boolean
}

/** Dependencies injected into the recycle-bin settings section. */
export interface RecycleBinSettingsFace {
  /** Reactive retention state. */
  readonly hooks: { readonly recycleBinSettings: SnapshotStore<RecycleBinSettingsState> }
  /** Persist a positive whole-day retention value. */
  saveRetentionDays(retentionDays: number): Promise<void>
}

/** Mirrors one Host-owned recycle-bin settings scope for the settings section. */
export class RecycleBinSettingsController {
  /** Snapshot consumed by the settings-section renderer. */
  readonly store: SnapshotStore<RecycleBinSettingsState>

  private retentionDays = DEFAULT_RECYCLE_BIN_SETTINGS.retentionDays
  private saving = false
  private failed = false
  private readonly unsubscribe: () => void

  /** @param scope - bound Host settings namespace. */
  constructor(private readonly scope: SettingsScope<RecycleBinSettings>) {
    this.store = createSnapshotStore(this.project())
    this.unsubscribe = scope.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /** Stop observing the settings namespace when the section unloads. */
  dispose(): void {
    this.unsubscribe()
  }

  /**
   * Expose the renderer store and persistence action for a mounted settings section.
   * @returns renderer hooks and persistence action.
   */
  inject(): RecycleBinSettingsFace {
    return {
      hooks: { recycleBinSettings: this.store },
      saveRetentionDays: retentionDays => this.saveRetentionDays(retentionDays),
    }
  }

  /**
   * Persist a valid positive whole-day retention value.
   * @param retentionDays - requested full-day retention.
   * @returns settlement after the scope accepts or recovers the write.
   */
  async saveRetentionDays(retentionDays: number): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (this.saving || snapshot.status !== 'ready' || !snapshot.writable) return
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
      this.failed = true
      this.publish()
      return
    }
    this.saving = true
    this.failed = false
    this.publish()
    try {
      await this.scope.set('retentionDays', retentionDays)
      this.failed = this.scope.getSnapshot().value?.retentionDays !== retentionDays
    } catch {
      this.failed = true
    }
    this.saving = false
    this.publish()
  }

  /** Adopt the Host-accepted setting without retaining a local draft. */
  private adopt(): void {
    const accepted = this.scope.getSnapshot().value
    if (accepted !== undefined) {
      this.retentionDays = accepted.retentionDays
      this.failed = false
    }
    this.publish()
  }

  /** Build the current immutable renderer projection. */
  private project(): RecycleBinSettingsState {
    const snapshot = this.scope.getSnapshot()
    return {
      status: snapshot.status,
      writable: snapshot.writable,
      retentionDays: this.retentionDays,
      saving: this.saving,
      failed: this.failed,
    }
  }

  /** Publish the latest settings projection. */
  private publish(): void {
    this.store.set(this.project())
  }
}
