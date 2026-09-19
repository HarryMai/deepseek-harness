import { rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createDevelopmentProjectDirectory,
  resolveDevelopmentLaunch,
} from '../scripts/dev.ts'

describe('desktop development launcher modes', () => {
  it('uses the shared DSH_HOME and Electron defaults for the compatibility launcher', () => {
    const launch = resolveDevelopmentLaunch('compatibility', '/tmp/desktop-project', {
      DSH_HOME: '/tmp/shared-dsh-home',
    })

    expect(launch.home).toBe(resolve('/tmp/shared-dsh-home'))
    expect(launch.userData).toBeUndefined()
    expect(launch.environment.DSH_HOME).toBe(resolve('/tmp/shared-dsh-home'))
    expect(launch.environment).toMatchObject({
      DSH_HOME: resolve('/tmp/shared-dsh-home'),
      DSH_DESKTOP_DSH_DIR: '/tmp/desktop-project',
      DSH_DESKTOP_DEV_PROJECT_DIR: '/tmp/desktop-project',
      DSH_DESKTOP_NODE_BINARY: process.execPath,
      DSH_DESKTOP_OPEN_DEVTOOLS: '0',
    })
    expect(launch.environment.DSH_DESKTOP_HOST_INSPECT_PORT).toBeUndefined()
    expect(launch.environment.ELECTRON_ENABLE_LOGGING).toBeUndefined()
    expect(launch.arguments).toEqual([resolve(import.meta.dirname, '..')])
  })

  it('resolves the compatibility launcher to ~/.dsh when DSH_HOME is unset', () => {
    const launch = resolveDevelopmentLaunch('compatibility', '/tmp/desktop-project', {})

    expect(launch.home).toBe(join(homedir(), '.dsh'))
    expect(launch.environment.DSH_HOME).toBe(launch.home)
  })

  it('retains an explicit DSH runtime override for the compatibility launcher', () => {
    const launch = resolveDevelopmentLaunch('compatibility', '/tmp/desktop-project', {
      DSH_DESKTOP_DSH_DIR: '/tmp/explicit-runtime',
    })

    expect(launch.environment.DSH_DESKTOP_DSH_DIR).toBe('/tmp/explicit-runtime')
  })

  it('keeps isolated development directories in the regular launcher mode', () => {
    const launch = resolveDevelopmentLaunch('isolated', '/tmp/desktop-project', {})

    expect(launch.home).toMatch(/[\\/]apps[\\/]desktop[\\/]\.desktop-build[\\/]development[\\/]home$/u)
    expect(launch.userData).toMatch(/[\\/]apps[\\/]desktop[\\/]\.desktop-build[\\/]development[\\/]electron-user-data$/u)
    expect(launch.environment.DSH_DESKTOP_OPEN_DEVTOOLS).toBe('1')
    expect(launch.arguments).toContain(`--user-data-dir=${launch.userData}`)
  })

  it('forces DevTools closed in compatibility mode', () => {
    const launch = resolveDevelopmentLaunch('compatibility', '/tmp/desktop-project', {
      DSH_HOME: '/tmp/shared-dsh-home',
      DSH_DESKTOP_OPEN_DEVTOOLS: '1',
    })

    expect(launch.environment.DSH_DESKTOP_OPEN_DEVTOOLS).toBe('0')
  })

  it('gives each compatibility launch its own disposable project directory', () => {
    const first = createDevelopmentProjectDirectory('compatibility')
    const second = createDevelopmentProjectDirectory('compatibility')
    try {
      expect(first).not.toBe(second)
      expect(first).toMatch(/[\\/]apps[\\/]desktop[\\/]\.desktop-build[\\/]development[\\/]compatibility-project-/u)
      expect(second).toMatch(/[\\/]apps[\\/]desktop[\\/]\.desktop-build[\\/]development[\\/]compatibility-project-/u)
    } finally {
      rmSync(first, { recursive: true, force: true })
      rmSync(second, { recursive: true, force: true })
    }
  })
})
