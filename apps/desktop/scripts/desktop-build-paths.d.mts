import type { DesktopAutoUpdateTarget } from './desktop-auto-update-environment.mjs'

/** Electron-builder output directory for every Desktop installer. */
export const DESKTOP_OUTPUT_DIR: string

/** Target-local preparation paths plus shared installer output and download cache. */
export interface DesktopTargetBuildPaths {
  readonly root: string
  readonly artifacts: string
  readonly runtime: string
  readonly packageSet: string
  readonly seed: string
  readonly seedPnpm: string
  readonly nodeExtract: string
  readonly packedDsh: string
  readonly packedVendor: string
  readonly packedLandlock: string
  readonly downloads: string
}

/**
 * Resolve the fixed build target selected by a packaging environment.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no target override exists.
 * @param hostArch - Build-host architecture used when no target override exists.
 * @returns Supported Desktop target name.
 */
export function resolveDesktopBuildTarget(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopAutoUpdateTarget

/**
 * Return target-scoped preparation paths plus the shared installer output directory.
 * @param target - Supported Desktop target name.
 * @returns Target paths plus shared installer output and immutable download cache.
 */
export function desktopTargetBuildPaths(target: DesktopAutoUpdateTarget): DesktopTargetBuildPaths

/**
 * Resolve the paths owned by the target selected in a packaging environment.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no target override exists.
 * @param hostArch - Build-host architecture used when no target override exists.
 * @returns Selected target paths.
 */
export function resolveDesktopTargetBuildPaths(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopTargetBuildPaths
