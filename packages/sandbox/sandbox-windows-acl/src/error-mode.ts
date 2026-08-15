/**
 * Hard-error popup suppression for the confined tree.
 *
 * When a confined process dies during loader initialization (the field's
 * intermittent STATUS_DLL_INIT_FAILED / 0xC0000142, System log Event 26) or
 * trips another hard-error condition, Windows' default is the modal
 * "Application Popup" dialog on the session's input desktop. A headless
 * console-less host tree can neither show that dialog usefully nor dismiss
 * it; the harness — not the user — is the right handler for a sandboxed
 * tool's failure, and it already reports the exit code through the tool
 * result.
 *
 * The process error mode (winbase.h SetErrorMode) governs exactly this
 * dispatch, and CreateProcess propagates it to children independent of the
 * token and desktop they run under — so installing the suppression on the
 * runner covers every descendant (pwsh, then its git/node grandchildren)
 * without touching the confinement mechanism itself. The desktop pin
 * (desktop.ts) remains the primary fix for the initialization failure; this
 * is the defense-in-depth layer that keeps any residual environmental
 * transient from ever surfacing as a user-facing system dialog.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/error-mode
 */

import * as abi from './win32-abi.ts'
import type { Win32Bindings } from './ffi.ts'

/** The error-mode mask the runner installs: every hard-error dialog class off. */
export const HARD_ERROR_POPUP_SUPPRESSION
  = abi.SEM_FAILCRITICALERRORS | abi.SEM_NOGPFAULTERRORBOX | abi.SEM_NOOPENFILEERRORBOX

/**
 * Install the popup-suppressing error mode on this process; children spawned
 * afterwards inherit it. SetErrorMode has no failure return (the previous
 * mode comes back unconditionally), so this never breaks the runner.
 * @param api - the binding table.
 * @returns the previous error mode, for the forensic log.
 */
export function suppressHardErrorPopups(api: Win32Bindings): number {
  return api.setErrorMode(HARD_ERROR_POPUP_SUPPRESSION)
}
