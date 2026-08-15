import { describe, expect, it } from 'vitest'
import { squirrelLifecycleAction } from '../src/squirrel.ts'

describe('Squirrel.Windows lifecycle actions', () => {
  it('creates only the configured Start menu shortcut after installation', () => {
    expect(squirrelLifecycleAction(
      ['DeepSeekHarness.exe', '--squirrel-install'],
      'C:\\Users\\test\\AppData\\Local\\DeepSeekHarness\\app-1.0.0\\DeepSeekHarness.exe',
      'win32',
      { desktop: false, startMenu: true },
    )).toEqual({
      kind: 'run',
      executable: 'C:\\Users\\test\\AppData\\Local\\DeepSeekHarness\\Update.exe',
      args: ['--createShortcut=DeepSeekHarness.exe', '--shortcut-locations=StartMenu'],
    })
  })

  it('removes every configured shortcut during uninstall', () => {
    expect(squirrelLifecycleAction(
      ['DeepSeekHarness.exe', '--squirrel-uninstall'],
      'C:\\application\\app-1.0.0\\DeepSeekHarness.exe',
      'win32',
      { desktop: true, startMenu: true },
    )).toEqual({
      kind: 'run',
      executable: 'C:\\application\\Update.exe',
      args: [
        '--removeShortcut=DeepSeekHarness.exe',
        '--shortcut-locations=Desktop,StartMenu',
      ],
    })
  })

  it('quits obsolete installers and skips normal or non-Windows startup', () => {
    expect(squirrelLifecycleAction(
      ['DeepSeekHarness.exe', '--squirrel-obsolete'],
      'C:\\application\\DeepSeekHarness.exe',
      'win32',
      { desktop: false, startMenu: true },
    )).toEqual({ kind: 'quit' })
    expect(squirrelLifecycleAction(
      ['DeepSeekHarness.exe'],
      'C:\\application\\DeepSeekHarness.exe',
      'win32',
      { desktop: false, startMenu: true },
    )).toBeUndefined()
    expect(squirrelLifecycleAction(
      ['DeepSeekHarness', '--squirrel-install'],
      '/application/DeepSeekHarness',
      'linux',
      { desktop: false, startMenu: true },
    )).toBeUndefined()
  })

  it('does not invoke Update.exe when both shortcut locations are disabled', () => {
    expect(squirrelLifecycleAction(
      ['DeepSeekHarness.exe', '--squirrel-updated'],
      'C:\\application\\app-1.0.0\\DeepSeekHarness.exe',
      'win32',
      { desktop: false, startMenu: false },
    )).toEqual({ kind: 'quit' })
  })
})
