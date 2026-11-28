/**
 * Extensible mobile push provider contract and registry.
 *
 * Add future providers (Android, HarmonyOS, Xiaomi, etc.) by implementing
 * {@link PushChannelAdapter} and registering them into {@link PushProviderRegistry}.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-notifications/providers
 */

import type {
  NotificationChannelIssue,
  NotificationChannelSettings,
  PushDeliveryResult,
  PushMessage,
} from '../types.ts'

/** Minimal fetch signature injected into push adapters for deterministic testing. */
export type PushFetch = typeof globalThis.fetch

/** Per-delivery execution options passed to a push provider adapter. */
export interface PushSendOptions {
  /** Bounded HTTP timeout in milliseconds. */
  readonly timeoutMs: number
  /** Optional caller or lifecycle cancellation signal. */
  readonly signal?: AbortSignal
  /** Optional fetch implementation override (defaults to `globalThis.fetch`). */
  readonly fetch?: PushFetch
}

/**
 * One mobile push provider adapter (Bark, Android, HarmonyOS, Xiaomi, etc.).
 * Implementations must contain transport failures into {@link PushDeliveryResult}
 * and never throw sensitive credentials into error messages.
 */
export interface PushChannelAdapter {
  /** Provider key matched against `channel.provider`. */
  readonly provider: string

  /**
   * Validate channel-specific configuration fields before delivery.
   * @param channel - channel settings to validate.
   * @returns a validation issue or `undefined` when deliverable.
   */
  validate(channel: NotificationChannelSettings): NotificationChannelIssue | undefined

  /**
   * Deliver one concise push message through this provider.
   * @param channel - validated channel settings.
   * @param message - concise notification title, body, and urgency metadata.
   * @param options - timeout, cancellation signal, and fetch transport.
   * @returns structured delivery outcome.
   */
  send(
    channel: NotificationChannelSettings,
    message: PushMessage,
    options: PushSendOptions,
  ): Promise<PushDeliveryResult>
}

/**
 * Registry mapping provider keys to their mobile push adapters.
 */
export class PushProviderRegistry {
  private readonly adapters = new Map<string, PushChannelAdapter>()

  /**
   * Register a push provider adapter and return its disposer.
   * @param adapter - push provider implementation.
   * @returns disposer that removes only this exact adapter registration.
   */
  register(adapter: PushChannelAdapter): () => void {
    const key = adapter.provider.trim()
    if (key.length === 0) throw new TypeError('push provider id must be non-empty')
    if (this.adapters.has(key)) throw new Error(`push provider "${key}" is already registered`)
    this.adapters.set(key, adapter)
    return () => {
      if (this.adapters.get(key) === adapter) this.adapters.delete(key)
    }
  }

  /**
   * Look up a registered adapter by provider key.
   * @param provider - configured provider key.
   * @returns matching adapter, or `undefined` if unsupported.
   */
  get(provider: string): PushChannelAdapter | undefined {
    return this.adapters.get(provider)
  }

  /**
   * List registered provider keys in deterministic order.
   * @returns sorted provider identifiers.
   */
  list(): string[] {
    return [...this.adapters.keys()].sort()
  }
}
