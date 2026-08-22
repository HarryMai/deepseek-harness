/** Workspace package graph decisions used by native desktop packaging. */

/** Package metadata needed to assemble the ordinary-Node Host runtime. */
export interface WorkspaceRuntimeManifest {
  readonly name: string
  readonly files?: readonly string[]
  readonly os?: readonly string[]
  readonly cpu?: readonly string[]
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

/** One current-workspace package and its source directory. */
export interface WorkspaceRuntimePackage {
  readonly path: string
  readonly manifest: WorkspaceRuntimeManifest
}

/** One platform targeted by a native desktop package. */
export interface WorkspaceRuntimeTarget {
  readonly os: string
  readonly cpu: string
}

/** Options that constrain which workspace packages can enter the runtime closure. */
export interface WorkspaceRuntimeClosureOptions {
  readonly targets?: readonly WorkspaceRuntimeTarget[]
}

function platformFieldAllows(entries: readonly string[] | undefined, value: string): boolean {
  if (entries === undefined || entries.length === 0) return true
  let hasPositive = false
  let positiveMatch = false
  for (const entry of entries) {
    if (entry.startsWith('!')) {
      if (entry.slice(1) === value) return false
      continue
    }
    hasPositive = true
    positiveMatch ||= entry === value
  }
  return hasPositive ? positiveMatch : true
}

function supportsTarget(manifest: WorkspaceRuntimeManifest, target: WorkspaceRuntimeTarget): boolean {
  return platformFieldAllows(manifest.os, target.os) && platformFieldAllows(manifest.cpu, target.cpu)
}

function supportsAnyTarget(
  manifest: WorkspaceRuntimeManifest,
  targets: readonly WorkspaceRuntimeTarget[] | undefined,
): boolean {
  if (targets === undefined || targets.length === 0) return true
  return targets.some(target => supportsTarget(manifest, target))
}

/**
 * Resolve every local package reachable through runtime and peer dependencies.
 * @param rootName - Package that owns the deployed application.
 * @param packages - Current workspace packages keyed by package name.
 * @param options - Target platforms used to skip workspace packages excluded by npm `os` or `cpu` fields.
 * @returns Reachable packages in stable name order.
 */
export function workspaceRuntimeClosure(
  rootName: string,
  packages: ReadonlyMap<string, WorkspaceRuntimePackage>,
  options: WorkspaceRuntimeClosureOptions = {},
): WorkspaceRuntimePackage[] {
  if (!packages.has(rootName)) throw new Error(`desktop installer: workspace package is missing: ${rootName}`)
  const pending = [rootName]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const name = pending.pop()
    if (name === undefined || visited.has(name)) continue
    visited.add(name)
    const current = packages.get(name)
    if (current === undefined) continue
    const manifest = current.manifest
    const dependencyNames = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]
    for (const dependency of dependencyNames) {
      const dependencyPackage = packages.get(dependency)
      if (
        dependencyPackage !== undefined
        && !visited.has(dependency)
        && supportsAnyTarget(dependencyPackage.manifest, options.targets)
      ) {
        pending.push(dependency)
      }
    }
  }
  return [...visited]
    .map(name => packages.get(name))
    .filter((value): value is WorkspaceRuntimePackage => value !== undefined)
    .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))
}

/**
 * Resolve top-level source entries selected by an npm package's files list.
 * @param manifest - Workspace package manifest.
 * @returns Source entry names plus the required package manifest.
 */
export function runtimePackageRoots(manifest: WorkspaceRuntimeManifest): string[] {
  if (manifest.files === undefined) {
    throw new Error(`desktop installer: workspace runtime package has no files list: ${manifest.name}`)
  }
  const roots = new Set<string>(['package.json'])
  for (const pattern of manifest.files) {
    if (pattern.startsWith('!')) continue
    const normalized = pattern.replaceAll('\\', '/')
    const [root] = normalized.split('/')
    if (root === undefined || root === '' || root === '.' || root === '..' || /[*?\[\]]/.test(root)) {
      throw new Error(`desktop installer: unsupported files entry for ${manifest.name}: ${pattern}`)
    }
    roots.add(root)
  }
  return [...roots].sort()
}
