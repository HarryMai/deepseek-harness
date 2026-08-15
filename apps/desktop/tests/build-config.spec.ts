import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDesktopBuildConfig } from '../src/build-config.ts'

const configPath = fileURLToPath(new URL('../desktop-build.config.json', import.meta.url))

function checkedInConfig(): unknown {
  return JSON.parse(readFileSync(configPath, 'utf8'))
}

describe('desktop build configuration', () => {
  it('accepts the checked-in unsigned Windows x64 installer settings', () => {
    const config = parseDesktopBuildConfig(checkedInConfig())
    expect(config.product.displayName).toBe('DeepSeek Harness')
    expect(config.windows).toMatchObject({
      architecture: 'x64',
      installer: {
        format: 'squirrel',
        scope: 'currentUser',
        unsigned: true,
        autoUpdate: false,
      },
    })
    expect(config.runtime.node).toEqual({ source: 'builder', version: '24.9.0' })
  })

  it('rejects silent unsupported behavior and misspelled fields', () => {
    const signed = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const windows = signed.windows as Record<string, Record<string, unknown>>
    windows.installer!.unsigned = false
    expect(() => parseDesktopBuildConfig(signed)).toThrow(/unsigned must be true/)

    const automaticUpdates = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const updateWindows = automaticUpdates.windows as Record<string, Record<string, unknown>>
    updateWindows.installer!.autoUpdate = true
    expect(() => parseDesktopBuildConfig(automaticUpdates)).toThrow(/autoUpdate must be false/)

    const misspelled = structuredClone(checkedInConfig()) as Record<string, unknown>
    misspelled.publiser = 'typo'
    expect(() => parseDesktopBuildConfig(misspelled)).toThrow(/unknown fields: publiser/)
  })

  it('requires Windows icon containers and safe executable names', () => {
    const wrongIcon = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const windows = wrongIcon.windows as Record<string, Record<string, unknown>>
    const icons = windows.icons as Record<string, unknown>
    icons.application = 'assets/icon.png'
    expect(() => parseDesktopBuildConfig(wrongIcon)).toThrow(/must name a Windows \.ico file/)

    const unsafeName = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    unsafeName.product!.executableName = 'DeepSeek Harness.exe'
    expect(() => parseDesktopBuildConfig(unsafeName)).toThrow(/filename without spaces or \.exe/)
  })
})
