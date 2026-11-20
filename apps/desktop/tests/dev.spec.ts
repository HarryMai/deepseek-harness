import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  createDevelopmentProjectDirectory,
  resolveDevelopmentLaunch,
} from '../scripts/dev.ts'

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-launch-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  return root
}

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

  it('migrates isolated development state and uses its new locations', () => {
    const root = fixture()
    const legacy = join(root, '.desktop-build', 'development')
    mkdirSync(join(legacy, 'home'), { recursive: true })
    mkdirSync(join(legacy, 'electron-user-data'))
    writeFileSync(join(legacy, 'home', 'session.jsonl'), 'session')

    const launch = resolveDevelopmentLaunch('isolated', '/tmp/desktop-project', {}, root)

    expect(launch.home).toBe(join(root, '.desktop-dev', 'home'))
    expect(launch.userData).toBe(join(root, '.desktop-dev', 'electron-user-data'))
    expect(readFileSync(join(launch.home, 'session.jsonl'), 'utf8')).toBe('session')
    expect(existsSync(join(legacy, 'home'))).toBe(false)
    expect(launch.environment.DSH_DESKTOP_OPEN_DEVTOOLS).toBe('1')
    expect(launch.arguments).toContain(`--user-data-dir=${launch.userData}`)
  })

  it('leaves isolated development state untouched in compatibility mode', () => {
    const root = fixture()
    const legacyHome = join(root, '.desktop-build', 'development', 'home')
    mkdirSync(legacyHome, { recursive: true })
    writeFileSync(join(legacyHome, 'session.jsonl'), 'session')

    resolveDevelopmentLaunch('compatibility', '/tmp/desktop-project', { DSH_HOME: '/tmp/shared-dsh-home' }, root)

    expect(readFileSync(join(legacyHome, 'session.jsonl'), 'utf8')).toBe('session')
    expect(existsSync(join(root, '.desktop-dev'))).toBe(false)
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
