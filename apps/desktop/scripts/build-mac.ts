/** Build the configured unsigned macOS DMG installers. */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { packager } from '@electron/packager'
import { parseDesktopBuildConfig, type DesktopBuildConfig, type DesktopMacConfig } from '../src/build-config.ts'
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

type MacArchitecture = DesktopMacConfig['architectures'][number]

const desktopRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(desktopRoot, '../..')
const buildRoot = join(desktopRoot, '.desktop-build')
const cacheRoot = join(desktopRoot, '.desktop-cache')
const packagedAppSource = join(buildRoot, 'app')
const hostRuntime = join(buildRoot, 'h')
const outputRoot = join(desktopRoot, 'out')
const packagedOutput = join(outputRoot, 'package')
const diskImageOutput = join(outputRoot, 'make', 'dmg')
const configPath = join(desktopRoot, 'desktop-build.config.json')
const desktopManifestPath = join(desktopRoot, 'package.json')

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
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`desktop installer: download failed with HTTP ${String(response.status)}: ${url}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

async function publishedSha256(listUrl: string, fileName: string): Promise<string> {
  const list = new TextDecoder().decode(await download(listUrl))
  for (const line of list.split('\n')) {
    const [sum, entry, ...rest] = line.trim().split(/\s+/)
    if (rest.length > 0 || sum === undefined || entry === undefined) continue
    if (!/^[0-9a-f]{64}$/.test(sum)) continue
    if (entry.replace(/^\*/, '') === fileName) return sum
  }
  throw new Error(`desktop installer: ${listUrl} has no SHA-256 entry for ${fileName}`)
}

async function cachedNodeArchive(version: string, architecture: MacArchitecture): Promise<string> {
  const archiveName = `node-v${version}-darwin-${architecture}.tar.gz`
  const expected = await publishedSha256(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`, archiveName)
  const directory = join(cacheRoot, 'node', `v${version}-darwin-${architecture}`)
  const archive = join(directory, archiveName)
  if (existsSync(archive)) {
    const actual = sha256(await readFile(archive))
    if (actual !== expected) {
      throw new Error(
        `desktop installer: cached Node ${version} darwin-${architecture} failed SHA-256 verification: ${archive}`,
      )
    }
    return archive
  }

  const url = `https://nodejs.org/dist/v${version}/${archiveName}`
  console.log(`desktop installer: download Node ${version} darwin-${architecture} from ${url}`)
  const content = await download(url)
  const actual = sha256(content)
  if (actual !== expected) {
    throw new Error(`desktop installer: downloaded Node ${version} darwin-${architecture} failed SHA-256 verification`)
  }
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `node-${String(process.pid)}.tmp`)
  await writeFile(temporary, content)
  await rename(temporary, archive)
  return archive
}

function assertBuildTarget(): void {
  if (process.platform !== 'darwin') {
    throw new Error(
      `desktop installer: build requires darwin; current host is ${process.platform}-${process.arch}`,
    )
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

async function electronZipDirectory(version: string, architecture: MacArchitecture): Promise<string> {
  const archiveName = `electron-v${version}-darwin-${architecture}.zip`
  const downloadDirectory = join(cacheRoot, 'electron', `v${version}-darwin-${architecture}`)
  if (existsSync(join(downloadDirectory, archiveName))) return downloadDirectory

  const configuredCache = process.env.electron_config_cache?.trim()
    || process.env.ELECTRON_CACHE?.trim()
  const electronCache = configuredCache || join(homedir(), 'Library', 'Caches', 'electron')
  if (existsSync(electronCache)) {
    const pending = [resolve(electronCache)]
    while (pending.length > 0) {
      const directory = pending.shift()
      if (directory === undefined) break
      const entries = await readdir(directory, { withFileTypes: true })
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isFile() && entry.name === archiveName) return directory
        if (entry.isDirectory()) pending.push(join(directory, entry.name))
      }
    }
  }

  const baseUrl = `https://github.com/electron/electron/releases/download/v${version}`
  const expected = await publishedSha256(`${baseUrl}/SHASUMS256.txt`, archiveName)
  console.log(`desktop installer: download Electron ${version} darwin-${architecture} from ${baseUrl}/${archiveName}`)
  const content = await download(`${baseUrl}/${archiveName}`)
  const actual = sha256(content)
  if (actual !== expected) {
    throw new Error(
      `desktop installer: downloaded Electron ${version} darwin-${architecture} failed SHA-256 verification`,
    )
  }
  await mkdir(downloadDirectory, { recursive: true })
  const temporary = join(downloadDirectory, `electron-${String(process.pid)}.tmp`)
  await writeFile(temporary, content)
  await rename(temporary, join(downloadDirectory, archiveName))
  return downloadDirectory
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
  // The Windows build hoists this provider dependency to keep Squirrel's legacy
  // .NET extraction paths below MAX_PATH; macOS packaging has no such limit.
  // Hoist only when pnpm produced the same nested layout, otherwise skip.
  const owner = '@earendil-works/pi-ai'
  const dependency = '@mistralai/mistralai'
  if (existsSync(join(hostRuntime, 'node_modules', owner, 'node_modules', dependency))) {
    await hoistNestedDependency(owner, dependency)
  }
  await pruneNonRuntimeArtifacts(hostRuntime)
  await copyFile(join(desktopRoot, 'lib/host.js'), join(hostRuntime, 'desktop-host-child.js'))
}

async function stageNodeRuntime(version: string, architecture: MacArchitecture): Promise<string> {
  const archive = await cachedNodeArchive(version, architecture)
  const distribution = `node-v${version}-darwin-${architecture}`
  const directory = join(buildRoot, architecture, 'n')
  await mkdir(directory, { recursive: true })
  await run(`extract Node ${version} darwin-${architecture} executable`, 'tar', [
    '-xzf',
    archive,
    '-C',
    directory,
    '--strip-components=2',
    `${distribution}/bin/node`,
  ])
  await run(`extract Node ${version} darwin-${architecture} license`, 'tar', [
    '-xzf',
    archive,
    '-C',
    directory,
    '--strip-components=1',
    `${distribution}/LICENSE`,
  ])
  const nodeExecutable = join(directory, 'node')
  if (!existsSync(nodeExecutable) || !existsSync(join(directory, 'LICENSE'))) {
    throw new Error(`desktop installer: Node archive is missing bin/node or LICENSE: ${archive}`)
  }
  await chmod(nodeExecutable, 0o755)
  return directory
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

async function createDiskImage(
  config: DesktopBuildConfig,
  architecture: MacArchitecture,
  applicationBundle: string,
): Promise<void> {
  const staging = join(buildRoot, 'dmg', architecture)
  await mkdir(staging, { recursive: true })
  await copyApplicationBundle(applicationBundle, join(staging, `${config.product.displayName}.app`))
  await symlink('/Applications', join(staging, 'Applications'), 'dir')
  const outputDirectory = join(diskImageOutput, architecture)
  await mkdir(outputDirectory, { recursive: true })
  const image = join(outputDirectory, config.mac.installer.outputFileName.replaceAll('{arch}', architecture))
  await run(`create disk image darwin-${architecture}`, 'hdiutil', [
    'create',
    '-volname',
    config.product.displayName,
    '-srcfolder',
    staging,
    '-ov',
    '-format',
    'UDZO',
    image,
  ])
  if (!existsSync(image)) {
    throw new Error(`desktop installer: disk image is missing after hdiutil create: ${image}`)
  }
}

async function main(): Promise<void> {
  const cli = buildCli(process.argv.slice(2))
  const config = await loadConfig()
  assertBuildTarget()
  const appIcon = iconPath(config.mac.icons.application, 'mac.icons.application')

  if (cli.dryRun) {
    console.log(`desktop installer: config ${configPath}`)
    console.log(
      `desktop installer: targets ${
        config.mac.architectures.map(architecture => `darwin-${architecture}`).join(', ')
      }, unsigned ${config.mac.installer.format}`,
    )
    console.log(`desktop installer: output ${config.mac.installer.outputFileName}`)
    console.log(`desktop installer: ordinary Node ${config.runtime.node.version} downloaded per architecture`)
    return
  }

  assertInsideDesktop(buildRoot, 'build root')
  assertInsideDesktop(outputRoot, 'output root')
  if (!cli.skipBuild) await runPnpm('build application artifacts', ['run', 'build'])
  await removeGeneratedTree(buildRoot)
  await removeGeneratedTree(outputRoot)
  await mkdir(buildRoot, { recursive: true })
  await stageHostRuntime(config.mac.architectures.map(architecture => ({ os: 'darwin', cpu: architecture })))
  const { electronVersion } = await stagePackagedApplication(config)
  for (const architecture of config.mac.architectures) {
    const nodeRuntime = await stageNodeRuntime(config.runtime.node.version, architecture)
    if (architecture === process.arch) {
      const smokeHome = join(buildRoot, 'smoke-home')
      await mkdir(smokeHome)
      await smokePackagedHost(
        join(nodeRuntime, 'node'),
        join(hostRuntime, 'desktop-host-child.js'),
        smokeHome,
      )
    } else {
      console.log(
        `desktop installer: skipping packaged Host smoke test for darwin-${architecture} on a darwin-${process.arch} builder`,
      )
    }
    const electronZipDir = await electronZipDirectory(electronVersion, architecture)
    const applicationDirectories = await packager({
      dir: packagedAppSource,
      platform: 'darwin',
      arch: architecture,
      out: packagedOutput,
      overwrite: true,
      prune: false,
      asar: true,
      electronVersion,
      electronZipDir,
      name: config.product.displayName,
      executableName: config.product.executableName,
      appCopyright: config.product.copyright,
      appBundleId: config.mac.bundleIdentifier,
      extraResource: [nodeRuntime, hostRuntime],
      ...(appIcon === undefined ? {} : { icon: appIcon }),
    })
    const [applicationDirectory] = applicationDirectories
    if (applicationDirectory === undefined || applicationDirectories.length !== 1) {
      throw new Error(`desktop installer: packager returned ${String(applicationDirectories.length)} application directories`)
    }
    const applicationBundle = join(applicationDirectory, `${config.product.displayName}.app`)
    for (const packagedRuntime of [
      join(applicationBundle, 'Contents', 'Resources', 'n', 'node'),
      join(applicationBundle, 'Contents', 'Resources', 'h', 'desktop-host-child.js'),
    ]) {
      if (!existsSync(packagedRuntime)) {
        throw new Error(`desktop installer: packaged runtime entry is missing: ${packagedRuntime}`)
      }
    }
    await createDiskImage(config, architecture, applicationBundle)
  }
  console.log(`desktop installer: artifacts written under ${diskImageOutput}`)
}

await main()
