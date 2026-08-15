/**
 * The console-less confinement desktop. When the runner has NO console
 * (GetConsoleWindow NULL — the desktop shell spawns the host tree with
 * windowsHide), a confined console-subsystem child cannot share a host
 * console; Windows initializes it against the interactive WinSta0\Default
 * instead. Under the WRITE_RESTRICTED token that path is nondeterministic:
 * the pass-2 restricted-SID check leans on whatever ACEs Default's DACL
 * happens to carry for the logon SID, and every console/desktop-heap user on
 * the machine shares Default's heap — field-verified 2026-08-15 as
 * intermittent STATUS_DLL_INIT_FAILED (0xC0000142) popups for git.exe /
 * node.exe grandchildren (System log Event 26), clustered around concurrent
 * sandboxed builds.
 *
 * The fix follows the standard sandbox pattern (Chromium's alternate
 * desktop): create a DEDICATED hidden desktop on the process's window
 * station, with a DACL that names the restricted token's restricting SIDs
 * explicitly (plus SYSTEM and Administrators for the csrss/kernel paths),
 * and pin STARTUPINFOW.lpDesktop to it. Every descendant inherits the
 * desktop, so console and user32/gdi32 initialization become deterministic,
 * each runner gets a fresh desktop heap, no conhost window can flash on the
 * user's screen, and confined processes lose any ambient access to the
 * user's desktop objects — a confinement IMPROVEMENT, not just a fix.
 *
 * Console-present runners (a terminal-hosted CLI) are untouched: children
 * keep sharing the host console, the long-standing known-good path.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/desktop
 */

import { randomBytes } from 'node:crypto'

import { allocPtrSlot, allocUint32, decodePtr, decodeUint32, isNullPtr, ptrAddress, throwLastError, throwWin32 } from './ffi.ts'
import type { NativePtr, Win32Bindings } from './ffi.ts'
import * as abi from './win32-abi.ts'

/** A created confinement desktop: the STARTUPINFOW.lpDesktop value plus the handle that keeps it alive. */
export interface SandboxDesktop {
  /** Full lpDesktop value ("<winsta name>\<desktop name>") for the confined spawn. */
  lpDesktop: string
  /** The desktop handle; the caller keeps it open until every confined child has exited. */
  handle: NativePtr
}

/**
 * True when this process owns a console window — the terminal-hosted CLI
 * condition. Console-present runners keep the shared-console spawn shape;
 * the dedicated desktop exists only for the console-less (desktop shell) one.
 * @param api - the binding table.
 * @returns whether a console window is attached.
 */
export function hasConsole(api: Win32Bindings): boolean {
  return !isNullPtr(api.getConsoleWindow())
}

/**
 * Build the DACL-only SDDL for a confinement desktop: one GENERIC_ALL allow
 * ACE per SID. The caller passes the restricted token's restricting SIDs
 * (logon SID, capability SIDs) so the WRITE_RESTRICTED pass-2 check passes
 * deterministically, plus SYSTEM/Administrators for kernel-side and
 * same-session management access (neither is in the confined token, so the
 * ACEs widen nothing the child can reach).
 * @param sids - SDDL string SIDs to grant.
 * @returns the "D:(A;;GA;;;…)…" security descriptor string.
 */
export function buildDesktopSddl(sids: readonly string[]): string {
  return `D:${sids.map(sid => `(A;;GA;;;${sid})`).join('')}`
}

/** Read a user object's UOI_NAME (the window-station name for lpDesktop composition). */
function userObjectName(api: Win32Bindings, handle: NativePtr, label: string): string {
  const neededSlot = allocUint32()
  api.getUserObjectInformationW(handle, abi.UOI_NAME, null, 0, neededSlot) // expected to fail with ERROR_INSUFFICIENT_BUFFER
  const needed = decodeUint32(neededSlot)
  if (needed === 0) throwLastError(api, 'GetUserObjectInformationW', `${label} name size query`)
  const buffer = Buffer.alloc(needed)
  if (api.getUserObjectInformationW(handle, abi.UOI_NAME, buffer, buffer.length, neededSlot) === 0) {
    throwLastError(api, 'GetUserObjectInformationW', `${label} name`)
  }
  return buffer.toString('utf16le').replace(/\0.*$/su, '')
}

/**
 * Create this runner's hidden confinement desktop on the process window
 * station and return the lpDesktop value to pin on confined spawns. The
 * desktop name carries the pid plus a random suffix so a stale desktop left
 * by a killed runner can never be reopened with a foreign DACL. The handle
 * keeps the desktop alive between spawns; the kernel destroys the desktop
 * once the last handle closes AND no process remains attached — confined
 * grandchildren outliving their direct parent keep it alive themselves.
 * Fails closed: any Win32 failure throws before the spawn.
 * @param api - the binding table.
 * @param sids - the DACL grantees (see {@link buildDesktopSddl}).
 * @returns the desktop to pin and later close.
 */
export function createSandboxDesktop(api: Win32Bindings, sids: readonly string[]): SandboxDesktop {
  const windowStation = api.getProcessWindowStation()
  if (isNullPtr(windowStation)) throwLastError(api, 'GetProcessWindowStation')
  const windowStationName = userObjectName(api, windowStation, 'window station')
  const name = `dsh-acl-${process.pid}-${randomBytes(3).toString('hex')}`
  const sddl = buildDesktopSddl(sids)

  const descriptorSlot = allocPtrSlot()
  if (api.convertStringSecurityDescriptorToSecurityDescriptorW(sddl, abi.SDDL_REVISION_1, descriptorSlot, null) === 0) {
    throwLastError(api, 'ConvertStringSecurityDescriptorToSecurityDescriptorW', sddl)
  }
  const descriptor = decodePtr(descriptorSlot)
  if (descriptor === null) throw new Error('ConvertStringSecurityDescriptorToSecurityDescriptorW returned a null security descriptor')

  // SECURITY_ATTRIBUTES { nLength, lpSecurityDescriptor, bInheritHandle: 0 } —
  // the desktop handle itself must NOT be inheritable: confined children
  // attach to the desktop by name through lpDesktop, never by handle.
  const attributes = Buffer.alloc(abi.SECURITY_ATTRIBUTES_SIZE)
  attributes.writeUInt32LE(abi.SECURITY_ATTRIBUTES_SIZE, 0)
  attributes.writeBigUInt64LE(ptrAddress(descriptor), 8)

  const handle = api.createDesktopW(name, null, null, 0, abi.GENERIC_ALL, attributes)
  const win32Code = isNullPtr(handle) ? api.getLastError() : 0
  // CreateDesktopW copies the descriptor during the call; free ours either way.
  const freed = api.localFree(descriptor)
  if (isNullPtr(handle)) throwWin32(api, 'CreateDesktopW', win32Code, `desktop: ${name}, sddl: ${sddl}`)
  if (!isNullPtr(freed)) {
    api.closeDesktop(handle)
    throwLastError(api, 'LocalFree', 'desktop security descriptor')
  }
  return { lpDesktop: `${windowStationName}\\${name}`, handle }
}

/**
 * Close the confinement desktop handle. The desktop object itself outlives
 * the handle for as long as any confined process stays attached to it.
 * @param api - the binding table.
 * @param desktop - the desktop to close.
 */
export function closeSandboxDesktop(api: Win32Bindings, desktop: SandboxDesktop): void {
  if (api.closeDesktop(desktop.handle) === 0) throwLastError(api, 'CloseDesktop', desktop.lpDesktop)
}
