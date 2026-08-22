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

  it('accepts the checked-in unsigned macOS DMG installer settings', () => {
    const config = parseDesktopBuildConfig(checkedInConfig())
    expect(config.mac).toEqual({
      architectures: ['x64', 'arm64'],
      bundleIdentifier: 'ai.deepseek.harness',
      installer: {
        format: 'dmg',
        outputFileName: 'DeepSeek Harness-{arch}.dmg',
        signing: 'none',
      },
      icons: { application: null },
    })
  })

  it('rejects unknown or missing macOS fields', () => {
    const missingMac = structuredClone(checkedInConfig()) as Record<string, unknown>
    delete missingMac.mac
    expect(() => parseDesktopBuildConfig(missingMac)).toThrow(/root is missing fields: mac/)

    const unknownField = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const mac = unknownField.mac as Record<string, unknown>
    mac.notarize = true
    expect(() => parseDesktopBuildConfig(unknownField)).toThrow(/mac has unknown fields: notarize/)

    const missingField = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const installerMac = missingField.mac as Record<string, Record<string, unknown>>
    delete installerMac.installer!.signing
    expect(() => parseDesktopBuildConfig(missingField)).toThrow(/mac\.installer is missing fields: signing/)
  })

  it('rejects unsupported macOS architectures and bundle identifiers', () => {
    const emptyArchitectures = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const emptyMac = emptyArchitectures.mac as Record<string, unknown>
    emptyMac.architectures = []
    expect(() => parseDesktopBuildConfig(emptyArchitectures)).toThrow(/mac\.architectures must be a non-empty array/)

    const duplicateArchitectures = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const duplicateMac = duplicateArchitectures.mac as Record<string, unknown>
    duplicateMac.architectures = ['x64', 'x64']
    expect(() => parseDesktopBuildConfig(duplicateArchitectures)).toThrow(/mac\.architectures\[1\] duplicates "x64"/)

    const unknownArchitecture = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const unknownMac = unknownArchitecture.mac as Record<string, unknown>
    unknownMac.architectures = ['ia32']
    expect(() => parseDesktopBuildConfig(unknownArchitecture)).toThrow(/mac\.architectures\[0\] must be "x64" or "arm64"/)

    const flatBundleIdentifier = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const flatMac = flatBundleIdentifier.mac as Record<string, unknown>
    flatMac.bundleIdentifier = 'DeepSeek'
    expect(() => parseDesktopBuildConfig(flatBundleIdentifier)).toThrow(/mac\.bundleIdentifier must be a reverse-DNS/)

    const upperBundleIdentifier = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const upperMac = upperBundleIdentifier.mac as Record<string, unknown>
    upperMac.bundleIdentifier = 'AI.deepseek.harness'
    expect(() => parseDesktopBuildConfig(upperBundleIdentifier)).toThrow(/mac\.bundleIdentifier must be a reverse-DNS/)
  })

  it('rejects macOS installers that are not unsigned placeholder DMGs', () => {
    const signed = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const signedMac = signed.mac as Record<string, Record<string, unknown>>
    signedMac.installer!.signing = 'adhoc'
    expect(() => parseDesktopBuildConfig(signed)).toThrow(/mac\.installer\.signing must be "none"/)

    const zipFormat = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const zipMac = zipFormat.mac as Record<string, Record<string, unknown>>
    zipMac.installer!.format = 'zip'
    expect(() => parseDesktopBuildConfig(zipFormat)).toThrow(/mac\.installer\.format must be "dmg"/)

    const noPlaceholder = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const placeholderMac = noPlaceholder.mac as Record<string, Record<string, unknown>>
    placeholderMac.installer!.outputFileName = 'DeepSeek Harness.dmg'
    expect(() => parseDesktopBuildConfig(noPlaceholder)).toThrow(/must be a plain \.dmg filename containing \{arch\}/)

    const wrongExtension = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const extensionMac = wrongExtension.mac as Record<string, Record<string, unknown>>
    extensionMac.installer!.outputFileName = 'DeepSeek Harness-{arch}.zip'
    expect(() => parseDesktopBuildConfig(wrongExtension)).toThrow(/must be a plain \.dmg filename containing \{arch\}/)

    const nestedPath = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const pathMac = nestedPath.mac as Record<string, Record<string, unknown>>
    pathMac.installer!.outputFileName = 'dist/DeepSeek Harness-{arch}.dmg'
    expect(() => parseDesktopBuildConfig(nestedPath)).toThrow(/must be a plain \.dmg filename containing \{arch\}/)

    const colonName = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const colonMac = colonName.mac as Record<string, Record<string, unknown>>
    colonMac.installer!.outputFileName = 'DeepSeek: Harness-{arch}.dmg'
    expect(() => parseDesktopBuildConfig(colonName)).toThrow(/must be a plain \.dmg filename containing \{arch\}/)
  })

  it('rejects macOS icons that are not .icns files', () => {
    const wrongIcon = structuredClone(checkedInConfig()) as Record<string, Record<string, unknown>>
    const mac = wrongIcon.mac as Record<string, Record<string, unknown>>
    const icons = mac.icons as Record<string, unknown>
    icons.application = 'assets/icon.png'
    expect(() => parseDesktopBuildConfig(wrongIcon)).toThrow(/must name a macOS \.icns file/)
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
