/**
 * Restricted-process spawning: anonymous pipes for stdio, STARTUPINFOW with
 * STARTF_USESTDHANDLES, CreateProcessAsUserW under the restricted token, then
 * asynchronous pipe draining and exit waiting. Console isolation
 * (CREATE_NO_WINDOW / CREATE_NEW_CONSOLE) is intentionally absent: under this
 * restriction scheme hidden-console children die with STATUS_DLL_INIT_FAILED
 * (0xC0000142) — verified empirically, see win32-abi.ts. Stdio redirection is
 * pipe-based and unaffected; the child shares the host console. When the host
 * has NO console (the desktop shell), the caller passes options.desktop — the
 * dedicated hidden confinement desktop from desktop.ts — which is pinned as
 * STARTUPINFOW.lpDesktop so console-subsystem descendants initialize
 * deterministically instead of dying intermittently against WinSta0\Default.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/spawn
 */

import {
  spawnInheritedJobProcess,
  spawnPipedProcess,
  waitForProcessExit,
} from '@deepseek-ai/dsh-win32-process'
import type {
  NativePtr,
  SpawnedJobProcess,
  SpawnedPipedProcess,
} from '@deepseek-ai/dsh-win32-process'
import { encodeStartupInfoDesktop } from './ffi.ts'
import type { Win32Bindings } from './ffi.ts'

export { drainPipe } from '@deepseek-ai/dsh-win32-process'

/** Restricted-token child with piped stdio resources. */
export interface SpawnedNative extends SpawnedPipedProcess {}
/** Restricted-token child assigned to a kill-on-close Job. */
export interface SpawnedInherited extends SpawnedJobProcess {}

type CreateProcessAsUserW = Win32Bindings['createProcessAsUserW']

/**
 * Pin a caller-selected desktop into the shared STARTUPINFOW allocation.
 * @param api - ACL/token binding table.
 * @param desktop - full window-station and desktop name, or undefined.
 * @param action - shared process operation to run with the adapted table.
 * @returns the shared operation's result.
 */
function withDesktop<T>(api: Win32Bindings, desktop: string | undefined, action: (api: Win32Bindings) => T): T {
  if (desktop === undefined) return action(api)
  const desktopBuffer = Buffer.from(`${desktop}\0`, 'utf16le')
  const createProcessAsUserW: CreateProcessAsUserW = (
    token,
    applicationName,
    commandLine,
    processAttributes,
    threadAttributes,
    inheritHandles,
    creationFlags,
    environment,
    currentDirectory,
    startupInfo,
    processInfo,
  ) => {
    encodeStartupInfoDesktop(startupInfo, desktopBuffer)
    return api.createProcessAsUserW(
      token,
      applicationName,
      commandLine,
      processAttributes,
      threadAttributes,
      inheritHandles,
      creationFlags,
      environment,
      currentDirectory,
      startupInfo,
      processInfo,
    )
  }
  return action({ ...api, createProcessAsUserW })
}

/**
 * Spawn a restricted-token child with piped stdout/stderr.
 * @param api - ACL/token binding table.
 * @param token - restricted primary token.
 * @param options - command, args, and working directory.
 * @returns process and caller-owned pipe handles.
 */
export function spawnSandboxed(
  api: Win32Bindings,
  token: NativePtr,
  options: { command: string; args: readonly string[]; cwd: string; desktop?: string | undefined },
): SpawnedNative {
  const { desktop, ...processOptions } = options
  return withDesktop(api, desktop, scopedApi =>
    spawnPipedProcess(scopedApi, { ...processOptions, token }))
}

/**
 * Spawn a restricted-token child in a kill-on-close Job with inherited stdio.
 * @param api - ACL/token binding table.
 * @param token - restricted primary token.
 * @param options - command, args, and working directory.
 * @returns process and Job handles after assignment and resume.
 */
export function spawnSandboxedInherited(
  api: Win32Bindings,
  token: NativePtr,
  options: { command: string; args: readonly string[]; cwd: string; desktop?: string | undefined },
): SpawnedInherited {
  const { desktop, ...processOptions } = options
  return withDesktop(api, desktop, scopedApi =>
    spawnInheritedJobProcess(scopedApi, { ...processOptions, token }))
}

/**
 * Wait for a restricted child and close its process handle.
 * @param api - ACL/token binding table.
 * @param process - caller-owned process handle.
 * @returns direct process exit code.
 */
export function waitForExit(api: Win32Bindings, process: NativePtr): number {
  return waitForProcessExit(api, process)
}
