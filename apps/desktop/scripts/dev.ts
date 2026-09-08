/** Build and launch the unpackaged Electron shell against the current workspace. */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import type { DesktopRelease } from '../src/release.ts'
import { prepareDevelopmentProject } from './development-project.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const BUILD_ROOT = join(APP_ROOT, '.desktop-build')
const DEVELOPMENT_ROOT = join(BUILD_ROOT, 'development')

interface PackageManifest {
  readonly version?: string
}

/** Launch mode for an unpackaged Desktop process. */
export type DesktopDevelopmentLaunchMode = 'isolated' | 'compatibility'

/** Resolved Electron process settings for an unpackaged Desktop launch. */
export interface DesktopDevelopmentLaunch {
  /** Harness home passed to the Desktop main process and Host child. */
  readonly home: string
  /** Explicit Electron user-data directory, when the launch mode requires one. */
  readonly userData: string | undefined
  /** Environment inherited by Electron. */
  readonly environment: NodeJS.ProcessEnv
  /** Electron arguments, including the application root. */
  readonly arguments: readonly string[]
}

/**
 * Allocate the disposable npm project directory for an unpackaged launch.
 * @param mode - Isolated development or compatibility launch mode.
 * @returns A project directory for the selected launch.
 */
export function createDevelopmentProjectDirectory(mode: DesktopDevelopmentLaunchMode): string {
  if (mode === 'isolated') return join(DEVELOPMENT_ROOT, 'project')
  mkdirSync(DEVELOPMENT_ROOT, { recursive: true })
  return mkdtempSync(join(DEVELOPMENT_ROOT, 'compatibility-project-'))
}

function packageVersion(path: string, subject: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
  if (typeof manifest.version !== 'string') throw new Error(`desktop development: ${subject} has no version`)
  return manifest.version
}

function debugPort(name: string, fallback: number, environment = process.env): number {
  const value = environment[name]
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 1 through 65535`)
  }
  return port
}

async function run(command: string, args: readonly string[], cwd: string, environment = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop development: ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

async function runPackageScript(script: string, cwd: string): Promise<void> {
  const packageManager = process.env.npm_execpath
  if (packageManager === undefined || packageManager === '') {
    throw new Error('desktop development: invoke this launcher through pnpm run dev:desktop or start:desktop')
  }
  await run(process.execPath, [packageManager, 'run', script], cwd)
}

/**
 * Resolve the process settings used by an unpackaged Desktop launch.
 *
 * Isolated mode uses disposable Harness and Electron data directories with
 * debug endpoints. Compatibility mode uses the resolved shared Harness home,
 * Electron's default user-data directory, and no debug endpoints.
 * @param mode - Isolated development mode or the root-command compatibility mode.
 * @param projectDir - Prepared development project passed to the main process.
 * @param environment - Environment to inherit and resolve launch overrides from.
 * @returns The resolved home, environment, and Electron arguments.
 */
export function resolveDevelopmentLaunch(
  mode: DesktopDevelopmentLaunchMode,
  projectDir: string,
  environment: NodeJS.ProcessEnv = process.env,
): DesktopDevelopmentLaunch {
  const compatibility = mode === 'compatibility'
  const home = compatibility
    ? resolveDshHome(undefined, environment)
    : resolve(environment.DSH_HOME ?? join(DEVELOPMENT_ROOT, 'home'))
  if (compatibility) {
    return {
      home,
      userData: undefined,
      environment: {
        ...environment,
        DSH_HOME: home,
        DSH_DESKTOP_DEV_PROJECT_DIR: projectDir,
        DSH_DESKTOP_NODE_BINARY: process.execPath,
        DSH_DESKTOP_OPEN_DEVTOOLS: '0',
      },
      arguments: [APP_ROOT],
    }
  }

  const mainPort = debugPort('DSH_DESKTOP_MAIN_INSPECT_PORT', 9229, environment)
  const rendererPort = debugPort('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9222, environment)
  const hostPort = debugPort('DSH_DESKTOP_HOST_INSPECT_PORT', 9230, environment)
  const userData = join(DEVELOPMENT_ROOT, 'electron-user-data')
  const launchArguments = [
    `--inspect=127.0.0.1:${String(mainPort)}`,
    `--remote-debugging-port=${String(rendererPort)}`,
    `--user-data-dir=${userData}`,
    APP_ROOT,
  ]
  return {
    home,
    userData,
    environment: {
      ...environment,
      DSH_HOME: home,
      DSH_DESKTOP_DEV_PROJECT_DIR: projectDir,
      DSH_DESKTOP_HOST_INSPECT_PORT: String(hostPort),
      DSH_DESKTOP_NODE_BINARY: process.execPath,
      DSH_DESKTOP_OPEN_DEVTOOLS: environment.DSH_DESKTOP_OPEN_DEVTOOLS ?? '1',
      ELECTRON_ENABLE_LOGGING: environment.ELECTRON_ENABLE_LOGGING ?? '1',
    },
    arguments: launchArguments,
  }
}

async function launchElectron(projectDir: string, mode: DesktopDevelopmentLaunchMode): Promise<void> {
  const require = createRequire(import.meta.url)
  const electron: unknown = require('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  const launch = resolveDevelopmentLaunch(mode, projectDir)
  console.log(`desktop development: DSH_HOME=${launch.home}`)
  if (mode === 'isolated') {
    console.log(`desktop development: inspectors main=${launch.arguments[0]?.split(':').at(-1)}, renderer=${launch.arguments[1]?.split('=').at(-1)}, host=${launch.environment.DSH_DESKTOP_HOST_INSPECT_PORT}`)
  }
  await run(electron, launch.arguments, APP_ROOT, launch.environment)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'skip-build': { type: 'boolean', default: false },
      compatibility: { type: 'boolean', default: false },
    },
  })
  if (!values['skip-build']) {
    await runPackageScript('build', REPOSITORY_ROOT)
    await runPackageScript('build', APP_ROOT)
  }
  for (const path of [
    join(APP_ROOT, 'lib', 'main.js'),
    join(REPOSITORY_ROOT, 'apps', 'desktop-host', 'lib', 'index.js'),
  ]) {
    if (!existsSync(path)) throw new Error(`desktop development: missing built artifact ${path}`)
  }
  const version = packageVersion(join(APP_ROOT, 'package.json'), 'desktop package')
  const pnpmVersion = packageVersion(join(APP_ROOT, 'node_modules', 'pnpm', 'package.json'), 'pnpm package')
  const release: DesktopRelease = {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: process.versions.node,
    pnpmVersion,
  }
  const mode = values.compatibility ? 'compatibility' : 'isolated'
  const projectDir = createDevelopmentProjectDirectory(mode)
  try {
    prepareDevelopmentProject({
      projectDir,
      cliDir: join(REPOSITORY_ROOT, 'apps', 'cli'),
      hostDir: join(REPOSITORY_ROOT, 'apps', 'desktop-host'),
      dependencyDir: join(REPOSITORY_ROOT, 'node_modules', '.pnpm', 'node_modules'),
      release,
    })
    await launchElectron(projectDir, mode)
  } finally {
    if (mode === 'compatibility') rmSync(projectDir, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
