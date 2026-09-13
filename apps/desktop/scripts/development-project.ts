/** Prepare the disposable npm-project view used by an unpackaged Electron shell. */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createDevelopmentProjectMetadata } from '../src/project-manager.ts'
import type { DesktopRelease } from '../src/release.ts'
import { workspaceRuntimeClosure, type WorkspaceRuntimePackage } from '../src/workspace-runtime.ts'

const CLI_PACKAGE = '@deepseek-ai/dsh'
const DESKTOP_HOST_PACKAGE = '@deepseek-ai/dsh-desktop-host'

interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly main?: string
  readonly files?: readonly string[]
  readonly os?: readonly string[]
  readonly cpu?: readonly string[]
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

/** Inputs whose locations differ between the launcher and isolated tests. */
export interface DevelopmentProjectOptions {
  /** Directory replaced with the generated development project. */
  readonly projectDir: string
  /** Current workspace's `apps/cli` package directory. */
  readonly cliDir: string
  /** Current workspace's private Desktop Host application directory. */
  readonly hostDir: string
  /** pnpm's workspace-wide virtual-hoist directory. */
  readonly dependencyDir: string
  /** Release identity written into the disposable project metadata. */
  readonly release: DesktopRelease
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function removeOwnedPath(path: string): void {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) {
    unlinkSync(path)
    return
  }
  if (stat.isDirectory()) {
    rmSync(path, { recursive: true })
    return
  }
  unlinkSync(path)
}

function linkDirectory(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(realpathSync(source), destination, process.platform === 'win32' ? 'junction' : 'dir')
}

function mirrorDependencyLinks(sourceRoot: string, destinationRoot: string): void {
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === '.bin') continue
    const source = join(sourceRoot, entry.name)
    if (entry.name.startsWith('@') && (entry.isDirectory() || entry.isSymbolicLink())) {
      if (entry.isSymbolicLink() && !existsSync(source)) continue
      mkdirSync(join(destinationRoot, entry.name), { recursive: true })
      for (const scoped of readdirSync(source, { withFileTypes: true })) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
        const scopedSource = join(source, scoped.name)
        if (scoped.isSymbolicLink() && !existsSync(scopedSource)) continue
        linkDirectory(scopedSource, join(destinationRoot, entry.name, scoped.name))
      }
      continue
    }
    if ((entry.isDirectory() || entry.isSymbolicLink()) && !(entry.isSymbolicLink() && !existsSync(source))) {
      linkDirectory(source, join(destinationRoot, entry.name))
    }
  }
}

function runtimePackage(path: string, manifest: PackageManifest): WorkspaceRuntimePackage | undefined {
  if (manifest.name === undefined) return
  return {
    path,
    manifest: {
      name: manifest.name,
      ...(manifest.files === undefined ? {} : { files: manifest.files }),
      ...(manifest.os === undefined ? {} : { os: manifest.os }),
      ...(manifest.cpu === undefined ? {} : { cpu: manifest.cpu }),
      ...(manifest.dependencies === undefined ? {} : { dependencies: manifest.dependencies }),
      ...(manifest.optionalDependencies === undefined ? {} : { optionalDependencies: manifest.optionalDependencies }),
      ...(manifest.peerDependencies === undefined ? {} : { peerDependencies: manifest.peerDependencies }),
    },
  }
}

function linkedWorkspacePackages(dependencyDir: string): Map<string, WorkspaceRuntimePackage> {
  const packages = new Map<string, WorkspaceRuntimePackage>()
  const scope = join(dependencyDir, '@deepseek-ai')
  if (!existsSync(scope)) return packages
  for (const entry of readdirSync(scope, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const path = join(scope, entry.name)
    if (!existsSync(path)) continue
    const workspacePackage = runtimePackage(path, readManifest(join(path, 'package.json')))
    if (workspacePackage !== undefined) packages.set(workspacePackage.manifest.name, workspacePackage)
  }
  return packages
}

function assertRuntimeBuildArtifacts(
  options: DevelopmentProjectOptions,
  cliManifest: PackageManifest,
  hostManifest: PackageManifest,
): void {
  const packages = linkedWorkspacePackages(options.dependencyDir)
  const cli = runtimePackage(options.cliDir, { ...cliManifest, name: CLI_PACKAGE })
  const host = runtimePackage(options.hostDir, { ...hostManifest, name: DESKTOP_HOST_PACKAGE })
  if (cli === undefined || host === undefined) throw new Error('desktop development: required workspace package metadata is missing')
  packages.set(CLI_PACKAGE, cli)
  packages.set(DESKTOP_HOST_PACKAGE, host)

  const runtimePackages = new Map<string, WorkspaceRuntimePackage>()
  for (const root of [CLI_PACKAGE, DESKTOP_HOST_PACKAGE]) {
    for (const workspacePackage of workspaceRuntimeClosure(root, packages)) {
      runtimePackages.set(workspacePackage.manifest.name, workspacePackage)
    }
  }
  const missing = [...runtimePackages.values()]
    .flatMap((workspacePackage) => {
      const entry = readManifest(join(workspacePackage.path, 'package.json')).main
      if (entry === undefined || existsSync(join(workspacePackage.path, entry))) return []
      return [`${workspacePackage.manifest.name}/${entry}`]
    })
    .sort((left, right) => left.localeCompare(right))
  if (missing.length > 0) {
    throw new Error(
      `desktop development: required workspace build artifacts are missing: ${missing.join(', ')}; run pnpm run build`,
    )
  }
}

/**
 * Replace one disposable project with links to the current built workspace.
 * @param options - Project destination, CLI package, and release identity.
 * @returns the absolute project directory supplied by the caller.
 */
export function prepareDevelopmentProject(options: DevelopmentProjectOptions): string {
  const cliManifest = readManifest(join(options.cliDir, 'package.json'))
  if (cliManifest.name !== CLI_PACKAGE || cliManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/cli must be ${CLI_PACKAGE}@${options.release.version}, found `
      + `${String(cliManifest.name)}@${String(cliManifest.version)}`,
    )
  }
  if (!existsSync(options.dependencyDir)) {
    throw new Error('desktop development: workspace dependency links are missing; run pnpm install')
  }
  const hostManifest = readManifest(join(options.hostDir, 'package.json'))
  if (hostManifest.name !== DESKTOP_HOST_PACKAGE || hostManifest.version !== options.release.version) {
    throw new Error(
      `desktop development: apps/desktop-host must be ${DESKTOP_HOST_PACKAGE}@${options.release.version}, found `
      + `${String(hostManifest.name)}@${String(hostManifest.version)}`,
    )
  }
  if (!existsSync(join(options.hostDir, 'lib', 'index.js'))) {
    throw new Error('desktop development: apps/desktop-host/lib/index.js is missing; run pnpm run build')
  }
  assertRuntimeBuildArtifacts(options, cliManifest, hostManifest)

  removeOwnedPath(options.projectDir)
  createDevelopmentProjectMetadata(options.projectDir, options.release)
  const destinationModules = join(options.projectDir, 'node_modules')
  mkdirSync(destinationModules, { recursive: true })
  mirrorDependencyLinks(options.dependencyDir, destinationModules)
  const dshLink = join(destinationModules, '@deepseek-ai', 'dsh')
  removeOwnedPath(dshLink)
  linkDirectory(options.cliDir, dshLink)
  const hostLink = join(destinationModules, '@deepseek-ai', 'dsh-desktop-host')
  removeOwnedPath(hostLink)
  linkDirectory(options.hostDir, hostLink)
  return options.projectDir
}
