/** Validation for the checked-in desktop installer configuration. */

/** Product metadata embedded into the desktop applications and installers. */
interface DesktopProductConfig {
  readonly displayName: string
  readonly internalName: string
  readonly executableName: string
  readonly publisher: string
  readonly description: string
  readonly copyright: string
  readonly versionSource: 'packageJson'
}

/** Squirrel.Windows behavior supported by the desktop build. */
interface DesktopWindowsInstallerConfig {
  readonly format: 'squirrel'
  readonly scope: 'currentUser'
  readonly packageName: string
  readonly outputFileName: string
  readonly createDesktopShortcut: boolean
  readonly createStartMenuShortcut: boolean
  readonly launchAfterInstall: true
  readonly autoUpdate: false
  readonly preserveUserDataOnUninstall: true
  readonly unsigned: true
}

/** Optional Windows icon paths, relative to `apps/desktop`. */
interface DesktopWindowsIconsConfig {
  readonly application: string | null
  readonly setup: string | null
}

/** Windows package target and installer settings. */
interface DesktopWindowsConfig {
  readonly architecture: 'x64'
  readonly installer: DesktopWindowsInstallerConfig
  readonly icons: DesktopWindowsIconsConfig
}

/** Optional macOS icon paths, relative to `apps/desktop`. */
interface DesktopMacIconsConfig {
  readonly application: string | null // null or a .icns filename
}

/** DMG behavior supported by the macOS desktop build. */
interface DesktopMacInstallerConfig {
  readonly format: 'dmg'
  readonly outputFileName: string // must contain the `{arch}` placeholder and end in .dmg
  readonly signing: 'none'
}

/** macOS package targets and installer settings. */
export interface DesktopMacConfig {
  readonly architectures: readonly ('x64' | 'arm64')[]
  readonly bundleIdentifier: string
  readonly installer: DesktopMacInstallerConfig
  readonly icons: DesktopMacIconsConfig
}

/** Ordinary Node runtime copied from the Windows builder into the installer. */
interface DesktopNodeRuntimeConfig {
  readonly source: 'builder'
  readonly version: string
}

/** Runtime resources shipped beside the Electron application. */
interface DesktopRuntimeBuildConfig {
  readonly node: DesktopNodeRuntimeConfig
  readonly offlineAfterInstall: true
}

/** Complete checked-in input for the desktop build. */
export interface DesktopBuildConfig {
  readonly schemaVersion: 1
  readonly product: DesktopProductConfig
  readonly windows: DesktopWindowsConfig
  readonly mac: DesktopMacConfig
  readonly runtime: DesktopRuntimeBuildConfig
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`desktop build config: ${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, path: string, keys: readonly string[]): void {
  const expected = new Set(keys)
  const unexpected = Object.keys(value).filter(key => !expected.has(key))
  const missing = keys.filter(key => !(key in value))
  if (unexpected.length > 0) {
    throw new Error(`desktop build config: ${path} has unknown fields: ${unexpected.join(', ')}`)
  }
  if (missing.length > 0) {
    throw new Error(`desktop build config: ${path} is missing fields: ${missing.join(', ')}`)
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`desktop build config: ${path} must be a non-empty string`)
  }
  return value
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`desktop build config: ${path} must be a boolean`)
  return value
}

function literal<T extends string | number | boolean>(value: unknown, path: string, expected: T): T {
  if (value !== expected) {
    throw new Error(`desktop build config: ${path} must be ${JSON.stringify(expected)}`)
  }
  return expected
}

function optionalIcon(value: unknown, path: string, platform: string, extension: string): string | null {
  if (value === null) return null
  const icon = string(value, path)
  if (!icon.toLowerCase().endsWith(extension)) {
    throw new Error(`desktop build config: ${path} must name a ${platform} ${extension} file`)
  }
  return icon
}

/**
 * Parse and validate one desktop build configuration.
 * @param value - Untrusted JSON value.
 * @returns The complete supported build configuration.
 */
export function parseDesktopBuildConfig(value: unknown): DesktopBuildConfig {
  const root = record(value, 'root')
  exactKeys(root, 'root', ['schemaVersion', 'product', 'windows', 'mac', 'runtime'])
  const schemaVersion = literal(root.schemaVersion, 'schemaVersion', 1)

  const product = record(root.product, 'product')
  exactKeys(product, 'product', [
    'displayName', 'internalName', 'executableName', 'publisher',
    'description', 'copyright', 'versionSource',
  ])
  const internalName = string(product.internalName, 'product.internalName')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(internalName)) {
    throw new Error('desktop build config: product.internalName must be lowercase letters, digits, or hyphens')
  }
  const executableName = string(product.executableName, 'product.executableName')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(executableName)) {
    throw new Error('desktop build config: product.executableName must be a filename without spaces or .exe')
  }
  const parsedProduct: DesktopProductConfig = {
    displayName: string(product.displayName, 'product.displayName'),
    internalName,
    executableName,
    publisher: string(product.publisher, 'product.publisher'),
    description: string(product.description, 'product.description'),
    copyright: string(product.copyright, 'product.copyright'),
    versionSource: literal(product.versionSource, 'product.versionSource', 'packageJson'),
  }

  const windows = record(root.windows, 'windows')
  exactKeys(windows, 'windows', ['architecture', 'installer', 'icons'])
  const installer = record(windows.installer, 'windows.installer')
  exactKeys(installer, 'windows.installer', [
    'format', 'scope', 'packageName', 'outputFileName', 'createDesktopShortcut',
    'createStartMenuShortcut', 'launchAfterInstall', 'autoUpdate',
    'preserveUserDataOnUninstall', 'unsigned',
  ])
  const packageName = string(installer.packageName, 'windows.installer.packageName')
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(packageName)) {
    throw new Error('desktop build config: windows.installer.packageName must be an alphanumeric NuGet name')
  }
  const outputFileName = string(installer.outputFileName, 'windows.installer.outputFileName')
  if (!outputFileName.toLowerCase().endsWith('.exe') || /[\\/:*?"<>|]/.test(outputFileName)) {
    throw new Error('desktop build config: windows.installer.outputFileName must be a plain .exe filename')
  }
  const parsedInstaller: DesktopWindowsInstallerConfig = {
    format: literal(installer.format, 'windows.installer.format', 'squirrel'),
    scope: literal(installer.scope, 'windows.installer.scope', 'currentUser'),
    packageName,
    outputFileName,
    createDesktopShortcut: boolean(installer.createDesktopShortcut, 'windows.installer.createDesktopShortcut'),
    createStartMenuShortcut: boolean(installer.createStartMenuShortcut, 'windows.installer.createStartMenuShortcut'),
    launchAfterInstall: literal(installer.launchAfterInstall, 'windows.installer.launchAfterInstall', true),
    autoUpdate: literal(installer.autoUpdate, 'windows.installer.autoUpdate', false),
    preserveUserDataOnUninstall: literal(
      installer.preserveUserDataOnUninstall,
      'windows.installer.preserveUserDataOnUninstall',
      true,
    ),
    unsigned: literal(installer.unsigned, 'windows.installer.unsigned', true),
  }
  const icons = record(windows.icons, 'windows.icons')
  exactKeys(icons, 'windows.icons', ['application', 'setup'])
  const parsedWindows: DesktopWindowsConfig = {
    architecture: literal(windows.architecture, 'windows.architecture', 'x64'),
    installer: parsedInstaller,
    icons: {
      application: optionalIcon(icons.application, 'windows.icons.application', 'Windows', '.ico'),
      setup: optionalIcon(icons.setup, 'windows.icons.setup', 'Windows', '.ico'),
    },
  }

  const mac = record(root.mac, 'mac')
  exactKeys(mac, 'mac', ['architectures', 'bundleIdentifier', 'installer', 'icons'])
  const macArchitectures = mac.architectures
  if (!Array.isArray(macArchitectures) || macArchitectures.length === 0) {
    throw new Error('desktop build config: mac.architectures must be a non-empty array')
  }
  const architectures: ('x64' | 'arm64')[] = []
  for (const [index, architecture] of (macArchitectures as unknown[]).entries()) {
    if (architecture !== 'x64' && architecture !== 'arm64') {
      throw new Error(`desktop build config: mac.architectures[${index}] must be "x64" or "arm64"`)
    }
    if (architectures.includes(architecture)) {
      throw new Error(`desktop build config: mac.architectures[${index}] duplicates ${JSON.stringify(architecture)}`)
    }
    architectures.push(architecture)
  }
  const bundleIdentifier = string(mac.bundleIdentifier, 'mac.bundleIdentifier')
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bundleIdentifier)) {
    throw new Error(
      'desktop build config: mac.bundleIdentifier must be a reverse-DNS identifier such as ai.deepseek.harness',
    )
  }
  const macInstaller = record(mac.installer, 'mac.installer')
  exactKeys(macInstaller, 'mac.installer', ['format', 'outputFileName', 'signing'])
  const macOutputFileName = string(macInstaller.outputFileName, 'mac.installer.outputFileName')
  if (
    !macOutputFileName.toLowerCase().endsWith('.dmg')
    || !macOutputFileName.includes('{arch}')
    || /[/:]/.test(macOutputFileName)
  ) {
    throw new Error(
      'desktop build config: mac.installer.outputFileName must be a plain .dmg filename containing {arch}',
    )
  }
  const parsedMacInstaller: DesktopMacInstallerConfig = {
    format: literal(macInstaller.format, 'mac.installer.format', 'dmg'),
    outputFileName: macOutputFileName,
    signing: literal(macInstaller.signing, 'mac.installer.signing', 'none'),
  }
  const macIcons = record(mac.icons, 'mac.icons')
  exactKeys(macIcons, 'mac.icons', ['application'])
  const parsedMac: DesktopMacConfig = {
    architectures,
    bundleIdentifier,
    installer: parsedMacInstaller,
    icons: {
      application: optionalIcon(macIcons.application, 'mac.icons.application', 'macOS', '.icns'),
    },
  }

  const runtime = record(root.runtime, 'runtime')
  exactKeys(runtime, 'runtime', ['node', 'offlineAfterInstall'])
  const node = record(runtime.node, 'runtime.node')
  exactKeys(node, 'runtime.node', ['source', 'version'])
  const nodeVersion = string(node.version, 'runtime.node.version')
  if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) {
    throw new Error('desktop build config: runtime.node.version must be an exact semver version')
  }

  return {
    schemaVersion,
    product: parsedProduct,
    windows: parsedWindows,
    mac: parsedMac,
    runtime: {
      node: {
        source: literal(node.source, 'runtime.node.source', 'builder'),
        version: nodeVersion,
      },
      offlineAfterInstall: literal(runtime.offlineAfterInstall, 'runtime.offlineAfterInstall', true),
    },
  }
}
