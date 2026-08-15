/**
 * Embeddable Web-profile host for product launchers that own their own process
 * and presentation lifecycle.
 * @module @deepseek-ai/dsh/desktop-host
 */

import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from './args.ts'
import { runProfile } from './profile-boot.ts'

/** Profile options resolved for the desktop-owned Web Host. */
export interface DesktopWebInvocation {
  /** Extra profile overlays supplied before the Web application's arguments. */
  readonly patchFiles: readonly string[]
  /** Loopback defaults followed by the Web application's arguments. */
  readonly args: readonly string[]
}

/**
 * Resolve desktop arguments through the public CLI launcher's Web alias.
 * @param args - Arguments after `dsh-desktop`.
 * @returns Profile overlays and Web arguments with desktop listener defaults.
 */
export function resolveDesktopWebInvocation(args: readonly string[]): DesktopWebInvocation {
  const invocation = parseDshArgs(['web', ...args], 'desktop')
  if (invocation.mode !== 'profile') {
    throw new Error('dsh-desktop: config dumps are available through the dsh CLI')
  }
  return {
    patchFiles: invocation.patches,
    args: ['--host', '127.0.0.1', '--port', '0', ...invocation.args],
  }
}

/**
 * Boot the shipped Web profile through the same composition as `dsh web`.
 * @param args - Desktop launcher arguments, including `--patch` before Web arguments.
 * @returns The live Cordis context and its bounded shutdown controller.
 */
export async function runWebProfile(args: readonly string[]): ReturnType<typeof runProfile> {
  const invocation = resolveDesktopWebInvocation(args)
  return runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'web',
    patchFiles: invocation.patchFiles,
    args: invocation.args,
  })
}
