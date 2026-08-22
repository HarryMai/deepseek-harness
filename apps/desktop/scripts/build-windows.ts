/** Build the configured unsigned Windows x64 Squirrel installer. */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  copyFile,
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, parse, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { packager } from '@electron/packager'
import { parseDesktopBuildConfig, type DesktopBuildConfig } from '../src/build-config.ts'
import { pnpmBuildCommand } from '../src/build-command.ts'
import { manageHostProcess, stopHostProcess, waitForHostReady } from '../src/process-lifecycle.ts'
import { copyApplicationBundle } from '../src/stage-application.ts'
import {
  runtimePackageRoots,
  workspaceRuntimeClosure,
  type WorkspaceRuntimeManifest,
  type WorkspaceRuntimePackage,
  type WorkspaceRuntimeTarget,
} from '../src/workspace-runtime.ts'

const desktopRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(desktopRoot, '../..')
const buildRoot = join(desktopRoot, '.desktop-build')
const cacheRoot = join(desktopRoot, '.desktop-cache')
const packagedAppSource = join(buildRoot, 'app')
const hostRuntime = join(buildRoot, 'h')
const nodeRuntime = join(buildRoot, 'n')
const outputRoot = join(desktopRoot, 'out')
const packagedOutput = join(outputRoot, 'package')
const installerOutput = join(outputRoot, 'make', 'squirrel.windows', 'x64')
const configPath = join(desktopRoot, 'desktop-build.config.json')
const desktopManifestPath = join(desktopRoot, 'package.json')
const nugetVersion = '6.14.3'
const nugetSha256 = '8103c5666f63528d9fec59b53c5ae4b6feed7c8aec2930e344e870375f408a90'
const nugetUrl = `https://dist.nuget.org/win-x86-commandline/v${nugetVersion}/nuget.exe`

interface BuildCli {
  readonly dryRun: boolean
  readonly skipBuild: boolean
}

function buildCli(argv: string[]): BuildCli {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      'skip-build': { type: 'boolean', default: false },
    },
  })
  return { dryRun: values['dry-run'], skipBuild: values['skip-build'] }
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(part => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ')
}

function run(label: string, command: string, args: string[], cwd = repositoryRoot): Promise<void> {
  console.log(`desktop installer: ${label}: ${formatCommand(command, args)}`)
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true })
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolveRun()
      else rejectRun(new Error(`desktop installer: ${label} failed (code ${String(code)}, signal ${String(signal)})`))
    })
  })
}

function runPnpm(label: string, args: string[]): Promise<void> {
  const command = pnpmBuildCommand(args)
  return run(label, command.command, command.args)
}

function capture(label: string, command: string, args: string[], cwd = repositoryRoot): Promise<string> {
  console.log(`desktop installer: ${label}: ${formatCommand(command, args)}`)
  return new Promise((resolveCapture, rejectCapture) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (value: string) => { stdout += value })
    child.once('error', rejectCapture)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) resolveCapture(stdout)
      else rejectCapture(new Error(`desktop installer: ${label} failed (code ${String(code)}, signal ${String(signal)})`))
    })
  })
}

function capturePnpm(label: string, args: string[]): Promise<string> {
  const command = pnpmBuildCommand(args)
  return capture(label, command.command, command.args)
}

async function removeGeneratedTree(directory: string): Promise<void> {
  if (!existsSync(directory)) return
  if (process.platform === 'win32') {
    const result = spawnSync('attrib.exe', ['-R', join(directory, '*'), '/S', '/D'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) {
      throw new Error(`desktop installer: could not make generated files writable (status ${String(result.status)})`)
    }
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

async function cachedNugetExecutable(): Promise<string> {
  const directory = join(cacheRoot, 'nuget', nugetVersion)
  const executable = join(directory, 'nuget.exe')
  if (existsSync(executable)) {
    const actual = sha256(await readFile(executable))
    if (actual !== nugetSha256) {
      throw new Error(`desktop installer: cached NuGet ${nugetVersion} failed SHA-256 verification: ${executable}`)
    }
    return executable
  }

  console.log(`desktop installer: download NuGet ${nugetVersion} from ${nugetUrl}`)
  const response = await fetch(nugetUrl)
  if (!response.ok) {
    throw new Error(`desktop installer: NuGet download failed with HTTP ${String(response.status)}: ${nugetUrl}`)
  }
  const content = new Uint8Array(await response.arrayBuffer())
  const actual = sha256(content)
  if (actual !== nugetSha256) {
    throw new Error(`desktop installer: downloaded NuGet ${nugetVersion} failed SHA-256 verification`)
  }
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `nuget-${String(process.pid)}.tmp`)
  await writeFile(temporary, content)
  await rename(temporary, executable)
  return executable
}

async function stageSquirrelVendor(): Promise<string> {
  const source = join(desktopRoot, 'node_modules', 'electron-winstaller', 'vendor')
  if (!existsSync(source)) {
    throw new Error(`desktop installer: electron-winstaller vendor tools are missing: ${source}`)
  }
  const destination = join(buildRoot, 'squirrel-vendor')
  await cp(source, destination, { recursive: true, dereference: true })
  await copyFile(await cachedNugetExecutable(), join(destination, 'nuget.exe'))
  return destination
}

async function withShortPackageRoot<T>(action: (directory: string) => Promise<T>): Promise<T> {
  let directory: string
  try {
    directory = await mkdtemp(join(parse(repositoryRoot).root, '.dsh-'))
  } catch (error) {
    if (!['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    directory = await mkdtemp(join(tmpdir(), '.dsh-'))
  }
  try {
    return await action(directory)
  } finally {
    const metadata = await lstat(directory)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`desktop installer: short package root changed type before cleanup: ${directory}`)
    }
    await removeGeneratedTree(directory)
  }
}

function assertBuildTarget(config: DesktopBuildConfig): void {
  if (process.platform !== 'win32' || process.arch !== config.windows.architecture) {
    throw new Error(
      `desktop installer: build requires win32-${config.windows.architecture}; current host is ${process.platform}-${process.arch}`,
    )
  }
  if (process.versions.node !== config.runtime.node.version) {
    throw new Error(
      `desktop installer: configured Node ${config.runtime.node.version} must match builder Node ${process.versions.node}`,
    )
  }
  if (!existsSync(process.execPath)) {
    throw new Error(`desktop installer: builder Node executable is missing: ${process.execPath}`)
  }
}

function assertInsideDesktop(path: string, label: string): void {
  const fromRoot = relative(desktopRoot, path)
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || resolve(path) === desktopRoot) {
    throw new Error(`desktop installer: ${label} must be below ${desktopRoot}, received ${path}`)
  }
}

function iconPath(value: string | null, label: string): string | undefined {
  if (value === null) return undefined
  const path = resolve(desktopRoot, value)
  assertInsideDesktop(path, label)
  if (!existsSync(path)) throw new Error(`desktop installer: ${label} is missing: ${path}`)
  return path
}

async function loadConfig(): Promise<DesktopBuildConfig> {
  return parseDesktopBuildConfig(JSON.parse(await readFile(configPath, 'utf8')))
}

async function electronZipDirectory(version: string, architecture: 'x64'): Promise<string> {
  const archiveName = `electron-v${version}-win32-${architecture}.zip`
  const configuredCache = process.env.electron_config_cache?.trim()
    || process.env.ELECTRON_CACHE?.trim()
  const localAppData = process.env.LOCALAPPDATA?.trim()
  const cacheRoot = configuredCache
    || (localAppData === undefined || localAppData === '' ? undefined : join(localAppData, 'electron', 'Cache'))
  if (cacheRoot === undefined || !existsSync(cacheRoot)) {
    throw new Error(
      `desktop installer: Electron cache is unavailable; run pnpm install or set electron_config_cache for ${archiveName}`,
    )
  }

  const pending = [resolve(cacheRoot)]
  while (pending.length > 0) {
    const directory = pending.shift()
    if (directory === undefined) break
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isFile() && entry.name === archiveName) return directory
      if (entry.isDirectory()) pending.push(join(directory, entry.name))
    }
  }
  throw new Error(`desktop installer: local Electron archive is missing from ${cacheRoot}: ${archiveName}`)
}

async function materializeLinks(directory: string): Promise<void> {
  async function collectLinks(parent: string, links: string[]): Promise<void> {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      const path = join(parent, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) {
        links.push(path)
        continue
      }
      if (metadata.isDirectory()) {
        await collectLinks(path, links)
      }
    }
  }

  const links: string[] = []
  await collectLinks(directory, links)
  for (const link of links.sort()) {
    const source = await realpath(link)
    const nestedNodeModules = join(source, 'node_modules')
    await rm(link, { recursive: true, force: true })
    await cp(source, link, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(`${nestedNodeModules}${sep}`),
    })
  }
}

interface PnpmWorkspaceListEntry {
  readonly name?: string
  readonly path?: string
}

async function loadWorkspaceRuntimePackages(): Promise<Map<string, WorkspaceRuntimePackage>> {
  const output = await capturePnpm('read current workspace package graph', [
    '--recursive',
    'list',
    '--depth',
    '-1',
    '--json',
  ])
  const entries = JSON.parse(output) as PnpmWorkspaceListEntry[]
  if (!Array.isArray(entries)) throw new Error('desktop installer: pnpm returned an invalid workspace package list')
  const packages = new Map<string, WorkspaceRuntimePackage>()
  for (const entry of entries) {
    const name = entry.name?.trim()
    const packagePath = entry.path === undefined ? undefined : resolve(entry.path)
    if (name === undefined || name === '' || packagePath === undefined) continue
    const fromRepository = relative(repositoryRoot, packagePath)
    if (fromRepository === '..' || fromRepository.startsWith(`..${sep}`)) {
      throw new Error(`desktop installer: workspace package is outside the repository: ${packagePath}`)
    }
    const manifest = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8')) as WorkspaceRuntimeManifest
    if (manifest.name !== name) {
      throw new Error(`desktop installer: workspace package name mismatch at ${packagePath}`)
    }
    packages.set(name, { path: packagePath, manifest })
  }
  return packages
}

async function stageMissingWorkspaceRuntimePackages(targets: readonly WorkspaceRuntimeTarget[]): Promise<void> {
  const packages = await loadWorkspaceRuntimePackages()
  const closure = workspaceRuntimeClosure('@deepseek-ai/dsh', packages, { targets })
  let copied = 0
  for (const workspacePackage of closure) {
    if (workspacePackage.manifest.name === '@deepseek-ai/dsh') continue
    const destination = join(hostRuntime, 'node_modules', workspacePackage.manifest.name)
    if (existsSync(destination)) continue
    await mkdir(destination, { recursive: true })
    for (const root of runtimePackageRoots(workspacePackage.manifest)) {
      const source = join(workspacePackage.path, root)
      if (!existsSync(source)) {
        throw new Error(`desktop installer: workspace runtime entry is missing: ${source}`)
      }
      await cp(source, join(destination, root), { recursive: true, dereference: true })
    }
    copied += 1
  }
  console.log(`desktop installer: staged ${String(closure.length)} current-workspace packages (${String(copied)} missing from pnpm deploy)`)
}

async function hoistNestedDependency(owner: string, dependency: string): Promise<void> {
  const nodeModules = join(hostRuntime, 'node_modules')
  const source = join(nodeModules, owner, 'node_modules', dependency)
  const destination = join(nodeModules, dependency)
  if (!existsSync(source) && existsSync(destination)) return
  if (!existsSync(source)) {
    throw new Error(`desktop installer: nested dependency is missing: ${owner} -> ${dependency}`)
  }
  if (existsSync(destination)) {
    throw new Error(`desktop installer: cannot hoist ${owner} -> ${dependency}; top-level destination already exists`)
  }
  await mkdir(dirname(destination), { recursive: true })
  await rename(source, destination)
}

async function pruneNonRuntimeArtifacts(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await pruneNonRuntimeArtifacts(path)
    } else if (entry.isFile() && (entry.name.endsWith('.map') || /\.d\.(?:ts|mts|cts)$/.test(entry.name))) {
      await rm(path)
    }
  }
}

async function stageHostRuntime(targets: readonly WorkspaceRuntimeTarget[]): Promise<void> {
  await runPnpm('deploy ordinary-Node Host closure', [
    '--filter',
    '@deepseek-ai/dsh',
    'deploy',
    '--legacy',
    '--prod',
    '--config.inject-workspace-packages=true',
    '--config.node-linker=hoisted',
    '--config.ignore-scripts=true',
    hostRuntime,
  ])
  await stageMissingWorkspaceRuntimePackages(targets)
  await materializeLinks(join(hostRuntime, 'node_modules'))
  // This provider dependency is unique in the closure. Hoisting preserves Node
  // resolution while keeping Squirrel's legacy .NET extraction paths below MAX_PATH.
  await hoistNestedDependency('@earendil-works/pi-ai', '@mistralai/mistralai')
  await pruneNonRuntimeArtifacts(hostRuntime)
  await copyFile(join(desktopRoot, 'lib/host.js'), join(hostRuntime, 'desktop-host-child.js'))
}

async function stageNodeRuntime(): Promise<void> {
  const nodeLicense = join(dirname(process.execPath), 'LICENSE')
  if (!existsSync(nodeLicense)) {
    throw new Error(`desktop installer: Node license is missing beside the builder executable: ${nodeLicense}`)
  }
  await mkdir(nodeRuntime, { recursive: true })
  await Promise.all([
    copyFile(process.execPath, join(nodeRuntime, 'node.exe')),
    copyFile(nodeLicense, join(nodeRuntime, 'LICENSE')),
  ])
}

interface DesktopPackageManifest {
  readonly version: string
  readonly dependencies?: Record<string, string>
}

async function stagePackagedApplication(config: DesktopBuildConfig): Promise<{ electronVersion: string; version: string }> {
  const desktopManifest = JSON.parse(await readFile(desktopManifestPath, 'utf8')) as DesktopPackageManifest
  const electronVersion = desktopManifest.dependencies?.electron
  if (electronVersion === undefined) {
    throw new Error('desktop installer: apps/desktop/package.json must pin Electron in dependencies')
  }
  const mainSource = join(desktopRoot, 'lib/main.js')
  const mainText = await readFile(mainSource, 'utf8')
  const forbiddenImport = /from\s+["']@deepseek-ai\//
  if (forbiddenImport.test(mainText)) {
    throw new Error('desktop installer: built Electron main still has a dependency that belongs in the bundled shell')
  }

  await mkdir(packagedAppSource, { recursive: true })
  await copyFile(mainSource, join(packagedAppSource, 'main.js'))
  const stagedManifest = {
    name: config.product.internalName,
    productName: config.product.displayName,
    version: desktopManifest.version,
    description: config.product.description,
    author: config.product.publisher,
    copyright: config.product.copyright,
    private: true,
    type: 'module',
    main: 'main.js',
    dependencies: {},
  }
  await writeFile(join(packagedAppSource, 'package.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`)
  return { electronVersion, version: desktopManifest.version }
}

async function smokePackagedHost(nodeExecutable: string, hostEntry: string, temporaryHome: string): Promise<void> {
  const child = spawn(
    nodeExecutable,
    [hostEntry],
    {
      env: { ...process.env, DSH_HOME: temporaryHome },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      windowsHide: true,
    },
  )
  const host = manageHostProcess(child)
  let startupError: unknown
  try {
    const url = await waitForHostReady(child, 60_000)
    console.log(`desktop installer: packaged Host ready at ${url}`)
  } catch (error) {
    startupError = error
  }
  try {
    await stopHostProcess(host, { gracefulTimeoutMs: 6_000 })
  } catch (shutdownError) {
    if (startupError !== undefined) {
      throw new AggregateError([startupError, shutdownError], 'desktop installer: packaged Host startup and shutdown failed')
    }
    throw shutdownError
  }
  if (startupError !== undefined) throw startupError
}

async function main(): Promise<void> {
  const cli = buildCli(process.argv.slice(2))
  const config = await loadConfig()
  assertBuildTarget(config)
  iconPath(config.windows.icons.application, 'windows.icons.application')
  iconPath(config.windows.icons.setup, 'windows.icons.setup')

  if (cli.dryRun) {
    console.log(`desktop installer: config ${configPath}`)
    console.log(`desktop installer: target win32-${config.windows.architecture}, unsigned ${config.windows.installer.format}`)
    console.log(`desktop installer: output ${config.windows.installer.outputFileName}`)
    console.log(`desktop installer: ordinary Node ${config.runtime.node.version} from ${process.execPath}`)
    return
  }

  assertInsideDesktop(buildRoot, 'build root')
  assertInsideDesktop(outputRoot, 'output root')
  if (!cli.skipBuild) await runPnpm('build application artifacts', ['run', 'build'])
  await removeGeneratedTree(buildRoot)
  await removeGeneratedTree(outputRoot)
  await mkdir(buildRoot, { recursive: true })
  await stageHostRuntime([{ os: 'win32', cpu: config.windows.architecture }])
  await stageNodeRuntime()
  const { electronVersion } = await stagePackagedApplication(config)
  const squirrelVendor = await stageSquirrelVendor()
  const electronZipDir = await electronZipDirectory(electronVersion, config.windows.architecture)
  const appIcon = iconPath(config.windows.icons.application, 'windows.icons.application')
  const setupIcon = iconPath(config.windows.icons.setup, 'windows.icons.setup')
  // Squirrel's NuGet cannot read long source paths even when Node can create them.
  await withShortPackageRoot(async (shortPackageRoot) => {
    const shortTempRoot = join(shortPackageRoot, 't')
    await mkdir(shortTempRoot)
    process.env.TEMP = shortTempRoot
    process.env.TMP = shortTempRoot
    // electron-winstaller's temp dependency captures TEMP when imported.
    const { createWindowsInstaller } = await import('electron-winstaller')
    const smokeHome = join(shortPackageRoot, 'u')
    await mkdir(smokeHome)
    await smokePackagedHost(
      join(nodeRuntime, 'node.exe'),
      join(hostRuntime, 'desktop-host-child.js'),
      smokeHome,
    )
    const applicationDirectories = await packager({
      dir: packagedAppSource,
      platform: 'win32',
      arch: config.windows.architecture,
      out: shortPackageRoot,
      overwrite: true,
      prune: false,
      asar: true,
      electronVersion,
      electronZipDir,
      name: 'd',
      executableName: config.product.executableName,
      appCopyright: config.product.copyright,
      win32metadata: {
        CompanyName: config.product.publisher,
        FileDescription: config.product.description,
        InternalName: config.product.executableName,
        OriginalFilename: `${config.product.executableName}.exe`,
        ProductName: config.product.displayName,
      },
      extraResource: [nodeRuntime, hostRuntime],
      ...(appIcon === undefined ? {} : { icon: appIcon }),
    })
    const [applicationDirectory] = applicationDirectories
    if (applicationDirectory === undefined || applicationDirectories.length !== 1) {
      throw new Error(`desktop installer: packager returned ${String(applicationDirectories.length)} application directories`)
    }
    for (const packagedRuntime of [
      join(applicationDirectory, 'resources', 'n', 'node.exe'),
      join(applicationDirectory, 'resources', 'h', 'desktop-host-child.js'),
    ]) {
      if (!existsSync(packagedRuntime)) {
        throw new Error(`desktop installer: packaged runtime entry is missing: ${packagedRuntime}`)
      }
    }
    await mkdir(packagedOutput, { recursive: true })
    await copyApplicationBundle(
      applicationDirectory,
      join(packagedOutput, `${config.product.displayName}-win32-${config.windows.architecture}`),
    )
    await createWindowsInstaller({
      appDirectory: applicationDirectory,
      outputDirectory: installerOutput,
      vendorDirectory: squirrelVendor,
      name: config.windows.installer.packageName,
      title: config.product.displayName,
      authors: config.product.publisher,
      description: config.product.description,
      exe: `${config.product.executableName}.exe`,
      setupExe: config.windows.installer.outputFileName,
      noMsi: true,
      noDelta: !config.windows.installer.autoUpdate,
      ...(setupIcon === undefined ? {} : { setupIcon }),
    })
  })
  console.log(`desktop installer: artifacts written under ${installerOutput}`)
}

await main()
