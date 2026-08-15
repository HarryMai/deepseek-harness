/**
 * desktop.ts tests: the SDDL builder as a pure function, plus live
 * create/close of the hidden confinement desktop through the real Win32
 * bindings — including the console-detection gate under a console-less child
 * process (the desktop-shell condition the desktop exists for).
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { buildDesktopSddl, closeSandboxDesktop, createSandboxDesktop } from '../src/desktop.ts'
import { Win32Error } from '../src/errors.ts'
import { win32Sync } from '../src/ffi.ts'

const isWin32 = process.platform === 'win32'

describe('buildDesktopSddl', () => {
  it('packs one GENERIC_ALL allow ACE per SID into a DACL-only descriptor', () => {
    expect(buildDesktopSddl(['S-1-5-18', 'S-1-1-0'])).toBe('D:(A;;GA;;;S-1-5-18)(A;;GA;;;S-1-1-0)')
    expect(buildDesktopSddl([])).toBe('D:')
  })
})

describe.skipIf(!isWin32)('windows-acl confinement desktop', () => {
  it('creates a desktop named on the current window station and closes it', () => {
    const api = win32Sync()
    const desktop = createSandboxDesktop(api, ['S-1-5-18', 'S-1-5-32-544', 'S-1-1-0'])
    try {
      expect(desktop.lpDesktop).toMatch(/^WinSta0\\dsh-acl-\d+-[0-9a-f]{6}$/u)
    } finally {
      closeSandboxDesktop(api, desktop)
    }
  })

  it('accepts capability SIDs (the workspace/temp S-1-4 shape) in the DACL', () => {
    const api = win32Sync()
    const desktop = createSandboxDesktop(api, ['S-1-1-0', 'S-1-4-123456-654321', 'S-1-4-123456-654321-1'])
    closeSandboxDesktop(api, desktop)
  })

  it('fails closed with the API name when the SDDL carries a garbage SID', () => {
    const api = win32Sync()
    expect(() => createSandboxDesktop(api, ['S-1-not-a-sid'])).toThrow(/ConvertStringSecurityDescriptorToSecurityDescriptorW/u)
    expect(() => createSandboxDesktop(api, ['S-1-not-a-sid'])).toThrow(Win32Error)
  })

  it('hasConsole is false in a console-less child (windowsHide) and desktop creation works there', () => {
    const probe = [
      "const { win32Sync } = await import('./ffi.ts')",
      "const { hasConsole, createSandboxDesktop, closeSandboxDesktop } = await import('./desktop.ts')",
      'const api = win32Sync()',
      "console.log('HAS-CONSOLE: ' + hasConsole(api))",
      "const desktop = createSandboxDesktop(api, ['S-1-5-18', 'S-1-1-0'])",
      "console.log('DESKTOP: ' + desktop.lpDesktop)",
      'closeSandboxDesktop(api, desktop)',
      "console.log('CLOSED')",
    ].join(';')
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', probe], {
      encoding: 'utf8',
      windowsHide: true,
      cwd: fileURLToPath(new URL('../src', import.meta.url)),
      timeout: 30_000,
    })
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('HAS-CONSOLE: false')
    expect(result.stdout).toMatch(/DESKTOP: WinSta0\\dsh-acl-\d+-[0-9a-f]{6}/u)
    expect(result.stdout).toContain('CLOSED')
  }, 30_000)
})
