import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_OUTPUT_DIR,
  desktopTargetBuildPaths,
  resolveDesktopBuildTarget,
} from '../scripts/desktop-build-paths.mjs'

describe('desktop build paths', () => {
  it('isolates every mutable build directory by complete target', () => {
    const arm64 = desktopTargetBuildPaths('mac-arm64')
    const x64 = desktopTargetBuildPaths('mac-x64')
    const windows = desktopTargetBuildPaths('win-x64')
    const mutableKeys = [
      'root',
      'runtime',
      'packageSet',
      'seed',
      'seedPnpm',
      'nodeExtract',
      'packedDsh',
      'packedVendor',
      'packedLandlock',
    ] as const

    for (const key of mutableKeys) {
      expect(new Set([arm64[key], x64[key], windows[key]]).size).toBe(3)
    }
    expect(arm64.root).toContain(join('.desktop-build', 'mac-arm64'))
    expect(x64.seed).toContain(join('.desktop-build', 'mac-x64', 'seed'))
    expect(windows.runtime).toContain(join('.desktop-build', 'win-x64', 'runtime'))
  })

  it('shares only the immutable upstream download cache', () => {
    const arm64 = desktopTargetBuildPaths('mac-arm64')
    const x64 = desktopTargetBuildPaths('mac-x64')
    expect(arm64.downloads).toBe(x64.downloads)
    expect(arm64.downloads).not.toContain(join('.desktop-build', 'mac-arm64'))
  })

  it('uses one installer output directory for every target', () => {
    const arm64 = desktopTargetBuildPaths('mac-arm64')
    const x64 = desktopTargetBuildPaths('mac-x64')
    const windows = desktopTargetBuildPaths('win-x64')
    expect(arm64.artifacts).toBe(DESKTOP_OUTPUT_DIR)
    expect(x64.artifacts).toBe(DESKTOP_OUTPUT_DIR)
    expect(windows.artifacts).toBe(DESKTOP_OUTPUT_DIR)
    expect(DESKTOP_OUTPUT_DIR).toContain(join('apps', 'desktop', 'out'))
  })

  it('resolves environment overrides and rejects unsupported targets', () => {
    expect(resolveDesktopBuildTarget({
      DSH_DESKTOP_TARGET_PLATFORM: 'darwin',
      DSH_DESKTOP_TARGET_ARCH: 'x64',
    }, 'darwin', 'arm64')).toBe('mac-x64')
    expect(resolveDesktopBuildTarget({}, 'win32', 'x64')).toBe('win-x64')
    expect(() => resolveDesktopBuildTarget({}, 'linux', 'x64')).toThrow(/unsupported target/u)
    expect(() => desktopTargetBuildPaths('linux-x64' as 'mac-x64')).toThrow(/unsupported target/u)
  })
})
