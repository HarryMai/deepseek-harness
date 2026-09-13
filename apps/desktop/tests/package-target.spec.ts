import { describe, expect, it } from 'vitest'
import {
  desktopElectronBuilderArguments,
  isDesktopPackageSigned,
  parseDesktopPackageInvocation,
  resolveDesktopPackageTarget,
  withoutDesktopUploadCredentials,
  withoutWindowsSigningEnvironment,
} from '../scripts/package-target.ts'

describe('desktop package target', () => {
  it('selects matching runtime and electron-builder architectures', () => {
    expect(resolveDesktopPackageTarget('mac-arm64', 'darwin', 'arm64')).toMatchObject({
      platform: 'darwin', arch: 'arm64', builderPlatform: '--mac', builderArch: '--arm64',
    })
    expect(resolveDesktopPackageTarget('mac-x64', 'darwin', 'x64')).toMatchObject({
      platform: 'darwin', arch: 'x64', builderPlatform: '--mac', builderArch: '--x64',
    })
    expect(resolveDesktopPackageTarget('win-x64', 'win32', 'x64')).toMatchObject({
      platform: 'win32', arch: 'x64', builderPlatform: '--win', builderArch: '--x64',
    })
  })

  it('allows a macOS host to build either macOS target', () => {
    expect(resolveDesktopPackageTarget('mac-arm64', 'darwin', 'x64').arch).toBe('arm64')
    expect(resolveDesktopPackageTarget('mac-x64', 'darwin', 'arm64').arch).toBe('x64')
  })

  it('rejects unsupported targets and hosts before building', () => {
    expect(() => resolveDesktopPackageTarget('linux-x64', 'linux', 'x64')).toThrow(/unsupported target/u)
    expect(() => resolveDesktopPackageTarget('win-x64', 'darwin', 'arm64')).toThrow(/Windows x64/u)
    expect(() => resolveDesktopPackageTarget('mac-arm64', 'linux', 'arm64')).toThrow(/macOS/u)
    expect(() => resolveDesktopPackageTarget('mac-x64', 'darwin', 'ppc64')).toThrow(/Rosetta/u)
  })

  it('maps the mac command to both macOS architectures', () => {
    expect(parseDesktopPackageInvocation(['mac'], 'darwin', 'arm64').targets.map(target => target.name))
      .toEqual(['mac-arm64', 'mac-x64'])
    expect(parseDesktopPackageInvocation(['mac'], 'darwin', 'x64').targets.map(target => target.name))
      .toEqual(['mac-arm64', 'mac-x64'])
    expect(parseDesktopPackageInvocation(['win'], 'win32', 'x64').targets.map(target => target.name))
      .toEqual(['win-x64'])
    expect(parseDesktopPackageInvocation([], 'darwin', 'arm64').targets.map(target => target.name))
      .toEqual(['mac-arm64'])
    expect(parseDesktopPackageInvocation(['--prepare-only'], 'darwin', 'arm64').prepareOnly).toBe(true)
    expect(() => parseDesktopPackageInvocation(['win'], 'darwin', 'arm64')).toThrow(/Windows x64/u)
    expect(() => parseDesktopPackageInvocation(['mac'], 'win32', 'x64')).toThrow(/macOS/u)
    expect(() => parseDesktopPackageInvocation(['mac-arm64'], 'darwin', 'arm64')).toThrow(/expected mac, win/u)
    expect(() => parseDesktopPackageInvocation(['mac', 'win'], 'darwin', 'arm64'))
      .toThrow(/at most one target/u)
  })

  it('keeps electron-builder publishing disabled for the separate validated upload', () => {
    const target = resolveDesktopPackageTarget('mac-arm64', 'darwin', 'arm64')
    expect(desktopElectronBuilderArguments(target, false)).toEqual([
      'exec',
      'electron-builder',
      '--config',
      'electron-builder.config.mjs',
      '--mac',
      '--arm64',
      '--publish',
      'never',
    ])
    expect(desktopElectronBuilderArguments(target, true)).toContain('--dir')
  })

  it('keeps Windows signing fields out of build and seed preparation subprocesses', () => {
    expect(withoutWindowsSigningEnvironment({
      DSH_DESKTOP_WINDOWS_CER_FILE: 'C:\\release\\server.cer',
      DSH_DESKTOP_WINDOWS_TOKEN_PIN: 'token-secret',
      DSH_DESKTOP_WINDOWS_KEY_CONTAINER: 'container',
      DSH_DESKTOP_WINDOWS_SIGNTOOL: 'C:\\tools\\signtool.exe',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    })).toEqual({ DSH_DESKTOP_AUTO_UPDATE_ENV: 'production' })
  })

  it('keeps COS credentials out of every packaging subprocess', () => {
    expect(withoutDesktopUploadCredentials({
      DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
      DOWNLOAD_TEST_COS_BUCKET: 'test-download-bucket',
      DOWNLOAD_TEST_COS_SECRET_ID: 'test-id',
      DOWNLOAD_TEST_COS_SECRET_KEY: 'test-key',
      DOWNLOAD_PROD_COS_BUCKET: 'production-download-bucket',
      DOWNLOAD_PROD_COS_SECRET_ID: 'production-id',
      DOWNLOAD_PROD_COS_SECRET_KEY: 'production-key',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    })).toEqual({
      DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
      DOWNLOAD_TEST_COS_BUCKET: 'test-download-bucket',
      DOWNLOAD_PROD_COS_BUCKET: 'production-download-bucket',
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
    })
  })

  it('uses each target certificate field to select signing', () => {
    const mac = resolveDesktopPackageTarget('mac-arm64', 'darwin', 'arm64')
    const windows = resolveDesktopPackageTarget('win-x64', 'win32', 'x64')
    expect(isDesktopPackageSigned(mac, {})).toBe(false)
    expect(isDesktopPackageSigned(mac, {
      DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company (TEAMID1234)',
    })).toBe(true)
    expect(isDesktopPackageSigned(windows, {})).toBe(false)
    expect(isDesktopPackageSigned(windows, {
      DSH_DESKTOP_WINDOWS_CER_FILE: 'C:\\release\\server.cer',
    })).toBe(true)
  })
})
