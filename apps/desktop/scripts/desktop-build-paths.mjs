/** Resolve target-scoped Desktop preparation paths and the common installer output. */

import { join, resolve } from 'node:path'

const APP_ROOT = resolve(import.meta.dirname, '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const SUPPORTED_TARGETS = new Set(['mac-arm64', 'mac-x64', 'win-x64'])

/** Electron-builder output directory for every Desktop installer. */
export const DESKTOP_OUTPUT_DIR = join(APP_ROOT, 'out')

/**
 * Resolve the fixed build target selected by a packaging environment.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no target override exists.
 * @param {string} hostArch - Build-host architecture used when no target override exists.
 * @returns {'mac-arm64' | 'mac-x64' | 'win-x64'} Supported Desktop target name.
 */
export function resolveDesktopBuildTarget(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const platform = env.DSH_DESKTOP_TARGET_PLATFORM ?? env.npm_config_platform ?? hostPlatform
  const arch = env.DSH_DESKTOP_TARGET_ARCH ?? env.npm_config_arch ?? hostArch
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' || platform === 'win' ? 'win' : platform
  const target = `${os}-${arch}`
  if (!SUPPORTED_TARGETS.has(target)) {
    throw new Error(`desktop build paths: unsupported target ${target}`)
  }
  return /** @type {'mac-arm64' | 'mac-x64' | 'win-x64'} */ (target)
}

/**
 * Return target-scoped preparation paths plus the shared installer output directory.
 * @param {'mac-arm64' | 'mac-x64' | 'win-x64'} target - Supported Desktop target name.
 * @returns {{ root: string, artifacts: string, runtime: string, packageSet: string, seed: string, seedPnpm: string, nodeExtract: string, packedDsh: string, packedVendor: string, packedLandlock: string, downloads: string }} Target paths plus shared installer output and immutable download cache.
 */
export function desktopTargetBuildPaths(target) {
  if (!SUPPORTED_TARGETS.has(target)) {
    throw new Error(`desktop build paths: unsupported target ${String(target)}`)
  }
  const root = join(BUILD_ROOT, target)
  const packed = join(root, 'packed')
  return {
    root,
    artifacts: DESKTOP_OUTPUT_DIR,
    runtime: join(root, 'runtime'),
    packageSet: join(root, 'package-set'),
    seed: join(root, 'seed'),
    seedPnpm: join(root, 'seed-pnpm'),
    nodeExtract: join(root, 'node-extract'),
    packedDsh: join(packed, 'dsh'),
    packedVendor: join(packed, 'vendor'),
    packedLandlock: join(packed, 'landlock'),
    downloads: join(BUILD_ROOT, 'downloads'),
  }
}

/**
 * Resolve the paths owned by the target selected in a packaging environment.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no target override exists.
 * @param {string} hostArch - Build-host architecture used when no target override exists.
 * @returns {ReturnType<typeof desktopTargetBuildPaths>} Selected target paths.
 */
export function resolveDesktopTargetBuildPaths(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  return desktopTargetBuildPaths(resolveDesktopBuildTarget(env, hostPlatform, hostArch))
}
