/**
 * The runner's forensic log channel. `--debug-log <path>` (forwarded by the
 * sandbox seam from the host's opt-in environment) turns on one JSON object
 * per line covering exactly the decisions a 0xC0000142 field report needs:
 * whether the runner had a console, whether and where the confinement
 * desktop was created, what was spawned under which pin, and how the child
 * exited. Without it a recurrence is a bare popup with no attributable
 * process tree; with it the next field occurrence is self-describing.
 *
 * Everything here is best-effort by contract: the log must never change the
 * runner's behavior, so every filesystem failure is swallowed. Appends are
 * one open/write/close each, safe for the handful of concurrent runners a
 * host may have live; past {@link DEBUG_LOG_MAX_BYTES} the file rotates
 * once (a single `.1` generation) on the next runner start.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/debug-log
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

/** Debug-log size cap: past it the next runner start rotates the file once. */
export const DEBUG_LOG_MAX_BYTES = 512 * 1024

/** One best-effort JSONL forensic sink; a no-op when no path was supplied. */
export class DebugLog {
  private readonly path: string | undefined

  constructor(path: string | undefined) {
    const trimmed = path?.trim()
    this.path = trimmed === undefined || trimmed === '' ? undefined : trimmed
    if (this.path === undefined) return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      if (statSync(this.path).size > DEBUG_LOG_MAX_BYTES) renameSync(this.path, `${this.path}.1`)
    } catch { /* an absent log fails statSync; rotation is best-effort either way */ }
  }

  /** Whether records land anywhere (false keeps every record call a no-op). */
  get enabled(): boolean {
    return this.path !== undefined
  }

  /**
   * Append one event line. Timestamp, runner pid, and the event name are
   * added; `fields` carries the event-specific facts.
   * @param event - the event name ('start', 'init', 'desktop', 'spawn', ...).
   * @param fields - the event's facts.
   */
  record(event: string, fields: Record<string, unknown> = {}): void {
    if (this.path === undefined) return
    try {
      appendFileSync(this.path, `${JSON.stringify({ t: new Date().toISOString(), pid: process.pid, event, ...fields })}\n`)
    } catch { /* the log must never break the runner */ }
  }
}
