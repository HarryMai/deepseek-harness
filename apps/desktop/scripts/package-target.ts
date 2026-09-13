/** Build one release target with matching Electron, Node.js, and seed architecture. */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { join, resolve } from 'node:path'
import {
  desktopBuildRecordFilename,
  resolveDesktopAutoUpdateConfig,
} from './desktop-auto-update-environment.mjs'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { hasMacOSSigningIdentity } from './desktop-release-environment.mjs'
import { hasWindowsSigningCertificate } from './windows-sign.mjs'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const WINDOWS_SIGNING_ENV_PREFIX = 'DSH_DESKTOP_WINDOWS_'
const WINDOWS_SIGNING_ENV_NAMES = [
  'DSH_DESKTOP_WINDOWS_CER_FILE',
  'DSH_DESKTOP_WINDOWS_KEY_CONTAINER',
  'DSH_DESKTOP_WINDOWS_SIGNTOOL',
  'DSH_DESKTOP_WINDOWS_TOKEN_PIN',
] as const
const DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES = new Set([
  'DOWNLOAD_TEST_COS_SECRET_ID',
  'DOWNLOAD_TEST_COS_SECRET_KEY',
  'DOWNLOAD_PROD_COS_SECRET_ID',
  'DOWNLOAD_PROD_COS_SECRET_KEY',
])

/** Fixed platform and architecture identifiers used by release records and update paths. */
export type DesktopPackageTargetName = 'mac-arm64' | 'mac-x64' | 'win-x64'

/** Platform selectors accepted by the public package commands. */
type DesktopPackagePlatform = 'mac' | 'win'

/** One supported release target and its electron-builder selectors. */
export interface DesktopPackageTarget {
  readonly name: DesktopPackageTargetName
  readonly platform: 'darwin' | 'win32'
  readonly arch: 'arm64' | 'x64'
  readonly builderPlatform: '--mac' | '--win'
  readonly builderArch: '--arm64' | '--x64'
}

const TARGETS: Record<DesktopPackageTargetName, DesktopPackageTarget> = {
  'mac-arm64': {
    name: 'mac-arm64',
    platform: 'darwin',
    arch: 'arm64',
    builderPlatform: '--mac',
    builderArch: '--arm64',
  },
  'mac-x64': {
    name: 'mac-x64',
    platform: 'darwin',
    arch: 'x64',
    builderPlatform: '--mac',
    builderArch: '--x64',
  },
  'win-x64': {
    name: 'win-x64',
    platform: 'win32',
    arch: 'x64',
    builderPlatform: '--win',
    builderArch: '--x64',
  },
}
const MAC_TARGET_NAMES = ['mac-arm64', 'mac-x64'] as const satisfies readonly DesktopPackageTargetName[]

/**
 * Remove Windows signing configuration from package preparation subprocesses.
 * @param environment - Packaging command environment.
 * @returns A copy without Windows signing fields.
 */
export function withoutWindowsSigningEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment)
    .filter(([name]) => !name.startsWith(WINDOWS_SIGNING_ENV_PREFIX)))
}

/**
 * Remove upload-only COS credentials from every packaging subprocess.
 * @param environment - Packaging command environment.
 * @returns A copy without Desktop upload credentials.
 */
export function withoutDesktopUploadCredentials(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment)
    .filter(([name]) => !DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES.has(name)))
}

/**
 * Report whether a target has the certificate input that enables its signing path.
 * @param target - Target selected for packaging.
 * @param environment - Electron-builder environment.
 * @returns Whether this package is signed and eligible for an upload completion record.
 */
export function isDesktopPackageSigned(
  target: DesktopPackageTarget,
  environment: NodeJS.ProcessEnv,
): boolean {
  return target.platform === 'darwin'
    ? hasMacOSSigningIdentity(environment)
    : hasWindowsSigningCertificate(environment)
}

function isTargetName(value: string): value is DesktopPackageTargetName {
  return Object.hasOwn(TARGETS, value)
}

function isPackagePlatform(value: string): value is DesktopPackagePlatform {
  return value === 'mac' || value === 'win'
}

function packageVersion(path: string, label: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error(`desktop package: ${label} has no version`)
  }
  return manifest.version
}

function writeReleaseRecord(
  target: DesktopPackageTarget,
  environment: NodeJS.ProcessEnv,
  artifactsRoot: string,
): void {
  const desktopVersion = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const dshVersion = packageVersion(join(REPOSITORY_ROOT, 'package.json'), 'dsh package')
  if (desktopVersion !== dshVersion) {
    throw new Error(`desktop package: desktop version ${desktopVersion} does not match dsh version ${dshVersion}`)
  }
  const update = resolveDesktopAutoUpdateConfig(environment, target.platform, target.arch)
  const recordPath = join(artifactsRoot, desktopBuildRecordFilename(target.name))
  const temporaryPath = `${recordPath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify({
    schemaVersion: 1,
    target: target.name,
    version: dshVersion,
    environment: update.environment,
    publicUrl: update.publicUrl,
  }, null, 2)}\n`)
  renameSync(temporaryPath, recordPath)
}

/**
 * Resolve a named release target and reject hosts that cannot execute its packaged runtime.
 * @param name - One of the fixed Desktop release target names.
 * @param hostPlatform - Build-host Node.js platform.
 * @param hostArch - Build-host Node.js architecture.
 * @returns The target selectors shared by runtime preparation and electron-builder.
 */
export function resolveDesktopPackageTarget(
  name: string,
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): DesktopPackageTarget {
  if (!isTargetName(name)) {
    throw new Error(`desktop package: unsupported target ${JSON.stringify(name)}; expected ${Object.keys(TARGETS).join(', ')}`)
  }
  const target = TARGETS[name]
  if (target.platform === 'win32' && (hostPlatform !== 'win32' || hostArch !== 'x64')) {
    throw new Error('desktop package: win-x64 requires a Windows x64 build host')
  }
  if (target.platform === 'darwin' && hostPlatform !== 'darwin') {
    throw new Error(`desktop package: ${name} requires a macOS build host`)
  }
  if (name === 'mac-x64' && hostArch !== 'arm64' && hostArch !== 'x64') {
    throw new Error('desktop package: mac-x64 requires an Intel Mac or Apple Silicon with Rosetta')
  }
  return target
}

interface DesktopPackageInvocation {
  readonly targets: readonly DesktopPackageTarget[]
  readonly directory: boolean
  readonly prepareOnly: boolean
}

function hostTargetName(platform: NodeJS.Platform, arch: string): DesktopPackageTargetName {
  const name = `${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform}-${arch}`
  if (!isTargetName(name)) throw new Error(`desktop package: unsupported build host ${platform}-${arch}`)
  return name
}

function targetNamesForPackagePlatform(
  platform: DesktopPackagePlatform,
  hostPlatform: NodeJS.Platform,
): readonly DesktopPackageTargetName[] {
  if (platform === 'mac') {
    if (hostPlatform !== 'darwin') throw new Error('desktop package: mac requires a macOS build host')
    return MAC_TARGET_NAMES
  }
  return ['win-x64']
}

/**
 * Parse the platform-selected packaging command line.
 * @param argv - Arguments after the script entry point, with at most one platform selector.
 * @param hostPlatform - Build-host Node.js platform.
 * @param hostArch - Build-host Node.js architecture.
 * @returns The validated release targets and whether to emit unpacked application directories.
 */
export function parseDesktopPackageInvocation(
  argv: readonly string[],
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): DesktopPackageInvocation {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      dir: { type: 'boolean', default: false },
      'prepare-only': { type: 'boolean', default: false },
    },
  })
  if (positionals.length > 1) throw new Error('desktop package: expected at most one target')
  const platform = positionals[0]
  if (platform !== undefined && !isPackagePlatform(platform)) {
    throw new Error(`desktop package: unsupported platform ${JSON.stringify(platform)}; expected mac, win`)
  }
  const names = platform === undefined
    ? [hostTargetName(hostPlatform, hostArch)]
    : targetNamesForPackagePlatform(platform, hostPlatform)
  return {
    targets: names.map(name => resolveDesktopPackageTarget(name, hostPlatform, hostArch)),
    directory: values.dir,
    prepareOnly: values['prepare-only'],
  }
}

/**
 * Build the electron-builder command arguments for one validated target.
 * @param target - Supported release target.
 * @param directory - Whether to stop at an unpacked application directory.
 * @returns Arguments that keep publishing under the separate validated upload command.
 */
export function desktopElectronBuilderArguments(
  target: DesktopPackageTarget,
  directory: boolean,
): readonly string[] {
  return [
    'exec',
    'electron-builder',
    '--config',
    'electron-builder.config.mjs',
    target.builderPlatform,
    target.builderArch,
    '--publish',
    'never',
    ...(directory ? ['--dir'] : []),
  ]
}

function runPnpm(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = APP_ROOT,
): Promise<void> {
  const pnpmEntry = process.env.npm_execpath
  if (pnpmEntry === undefined || pnpmEntry === '') {
    throw new Error('desktop package: invoke this script through a pnpm package command')
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [pnpmEntry, ...args], {
      cwd,
      env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop package: pnpm ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

async function packageTarget(
  target: DesktopPackageTarget,
  directory: boolean,
  prepareOnly: boolean,
  buildEnv: NodeJS.ProcessEnv,
): Promise<void> {
  const buildPaths = desktopTargetBuildPaths(target.name)
  const releaseRecordPath = join(buildPaths.artifacts, desktopBuildRecordFilename(target.name))
  if (!prepareOnly) {
    rmSync(releaseRecordPath, { force: true })
    rmSync(`${releaseRecordPath}.tmp`, { force: true })
  }
  const targetEnv: NodeJS.ProcessEnv = {
    ...buildEnv,
    DSH_DESKTOP_TARGET_PLATFORM: target.platform,
    DSH_DESKTOP_TARGET_ARCH: target.arch,
    ...(target.platform === 'darwin' && !hasMacOSSigningIdentity(buildEnv)
      ? { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
      : {}),
  }
  const electronBuilderEnv = { ...targetEnv }
  for (const name of WINDOWS_SIGNING_ENV_NAMES) {
    if (process.env[name] !== undefined) electronBuilderEnv[name] = process.env[name]
  }
  const signed = isDesktopPackageSigned(target, electronBuilderEnv)
  await runPnpm(['run', 'release:pack', '--family', 'dsh', '--out', buildPaths.packedDsh], buildEnv, REPOSITORY_ROOT)
  await runPnpm([
    '--dir',
    'apps/desktop-host',
    'pack',
    '--pack-destination',
    buildPaths.packedDsh,
  ], buildEnv, REPOSITORY_ROOT)
  await runPnpm(['run', 'release:pack', '--family', 'vendor', '--out', buildPaths.packedVendor], buildEnv, REPOSITORY_ROOT)
  rmSync(buildPaths.packedLandlock, { recursive: true, force: true })
  mkdirSync(buildPaths.packedLandlock, { recursive: true })
  await runPnpm([
    '--dir',
    'native/system/packages/entry',
    'pack',
    '--pack-destination',
    buildPaths.packedLandlock,
  ], buildEnv, REPOSITORY_ROOT)
  await runPnpm(['run', 'prepare:runtime'], targetEnv)
  await runPnpm(['run', 'prepare:packages'], targetEnv)
  await runPnpm(['run', 'prepare:seed'], targetEnv)
  if (prepareOnly) return
  await runPnpm(desktopElectronBuilderArguments(target, directory), electronBuilderEnv)
  if (!directory && signed) writeReleaseRecord(target, electronBuilderEnv, buildPaths.artifacts)
}

async function main(): Promise<void> {
  const invocation = parseDesktopPackageInvocation(process.argv.slice(2))
  const buildEnv = withoutWindowsSigningEnvironment(withoutDesktopUploadCredentials(process.env))
  await runPnpm(['run', 'build:official'], buildEnv, REPOSITORY_ROOT)
  await runPnpm(['--dir', 'native/system', 'run', 'build:ts'], buildEnv, REPOSITORY_ROOT)
  for (const target of invocation.targets) {
    await packageTarget(target, invocation.directory, invocation.prepareOnly, buildEnv)
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
