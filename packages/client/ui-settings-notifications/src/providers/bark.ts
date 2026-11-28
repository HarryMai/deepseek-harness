/**
 * Bark Server push notification adapter (Stage 1: iOS / macOS Bark).
 *
 * Uses the standard Bark Server JSON endpoint (`POST <serverUrl>/push`) so both
 * the official server (`https://api.day.app`) and self-hosted Bark instances work
 * without exposing the device key in URL path logs.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-notifications/providers/bark
 */

import {
  channelIssue,
  type NotificationChannelIssue,
  type NotificationChannelSettings,
  type PushDeliveryResult,
  type PushMessage,
} from '../types.ts'
import type { PushChannelAdapter, PushSendOptions } from './types.ts'

/** JSON request body accepted by Bark Server's `/push` endpoint. */
export interface BarkPushPayload {
  readonly device_key: string
  readonly title: string
  readonly body: string
  readonly group: string
  readonly level: 'active' | 'timeSensitive' | 'passive'
  readonly sound?: string
}

/**
 * Resolve the Bark `/push` endpoint URL from a configured server base URL.
 * Preserves optional base path prefixes and avoids doubling a trailing `/push`.
 *
 * @param serverUrl - validated HTTP(S) Bark server address.
 * @returns absolute endpoint URL for JSON POST delivery.
 */
export function resolveBarkPushEndpoint(serverUrl: string): string {
  const url = new URL(serverUrl.trim())
  const normalizedPath = url.pathname.replace(/\/+$/u, '')
  url.pathname = normalizedPath.endsWith('/push') ? normalizedPath : `${normalizedPath}/push`
  url.search = ''
  url.hash = ''
  return url.toString()
}

/**
 * Build the Bark JSON request payload from one channel record and concise message.
 *
 * @param channel - Bark channel settings.
 * @param message - concise notification content.
 * @returns Bark `/push` JSON payload.
 */
export function buildBarkPayload(
  channel: NotificationChannelSettings,
  message: PushMessage,
): BarkPushPayload {
  const group = channel.group.trim() || message.defaultGroup
  const sound = channel.sound.trim()
  const level = channel.level === '' ? message.defaultLevel : channel.level
  return {
    device_key: channel.deviceKey.trim(),
    title: message.title,
    body: message.body,
    group,
    level,
    ...(sound.length > 0 ? { sound } : {}),
  }
}

/** Inspect optional Bark JSON response body for application-level errors (e.g. `{ code: 400 }`). */
async function readBarkResponseCode(response: Response): Promise<number | undefined> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('json')) return undefined
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch (_nonJsonBody) {
    // Some reverse proxies mislabel empty/plain 200 responses as JSON; treat HTTP status as authoritative.
    return undefined
  }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const code = (parsed as Record<string, unknown>).code
    if (typeof code === 'number' && Number.isInteger(code)) return code
  }
  return undefined
}

/** Combine caller cancellation and per-request timeout into one AbortSignal. */
function buildRequestSignal(timeoutMs: number, upstream: AbortSignal | undefined): {
  readonly signal: AbortSignal
  readonly timedOut: () => boolean
} {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = upstream === undefined ? timeoutSignal : AbortSignal.any([upstream, timeoutSignal])
  return {
    signal,
    timedOut: () => timeoutSignal.aborted && !(upstream?.aborted ?? false),
  }
}

/**
 * Bark Server mobile push adapter.
 */
export class BarkPushAdapter implements PushChannelAdapter {
  readonly provider = 'bark'

  /**
   * Validate Bark server URL and device key.
   * @param channel - candidate Bark channel configuration.
   * @returns first validation issue, or `undefined` when deliverable.
   */
  validate(channel: NotificationChannelSettings): NotificationChannelIssue | undefined {
    return channelIssue(channel, false)
  }

  /**
   * Send a concise push message to a Bark Server over HTTP POST JSON.
   * @param channel - Bark channel configuration.
   * @param message - concise notification title and body.
   * @param options - timeout, cancellation signal, and fetch transport.
   * @returns structured delivery result safe for logs and UI status.
   */
  async send(
    channel: NotificationChannelSettings,
    message: PushMessage,
    options: PushSendOptions,
  ): Promise<PushDeliveryResult> {
    if (this.validate(channel) !== undefined) {
      return { ok: false, reason: 'invalid-configuration' }
    }
    if (options.signal?.aborted) {
      return { ok: false, reason: 'cancelled' }
    }

    const endpoint = resolveBarkPushEndpoint(channel.serverUrl)
    const payload = buildBarkPayload(channel, message)
    const fetchImpl = options.fetch ?? globalThis.fetch
    const { signal, timedOut } = buildRequestSignal(options.timeoutMs, options.signal)

    let response: Response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      })
    } catch (_transportError) {
      // Transport and abort errors map directly to browser-safe delivery failure categories.
      if (timedOut()) return { ok: false, reason: 'timed-out' }
      if (options.signal?.aborted) return { ok: false, reason: 'cancelled' }
      return { ok: false, reason: 'request-failed' }
    }

    if (!response.ok) {
      return { ok: false, reason: 'http-error', statusCode: response.status }
    }

    const barkCode = await readBarkResponseCode(response)
    if (barkCode !== undefined && barkCode !== 200) {
      return { ok: false, reason: 'http-error', statusCode: barkCode }
    }

    return { ok: true, statusCode: barkCode ?? response.status }
  }
}
