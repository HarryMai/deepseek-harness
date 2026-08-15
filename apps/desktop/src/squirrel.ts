/** Squirrel.Windows lifecycle argument handling for the packaged desktop shell. */

import { win32 } from 'node:path'

/** Process action required for one Squirrel.Windows lifecycle event. */
export type SquirrelLifecycleAction =
  | { readonly kind: 'quit' }
  | {
    readonly kind: 'run'
    readonly executable: string
    readonly args: readonly string[]
  }

interface SquirrelShortcutConfig {
  readonly desktop: boolean
  readonly startMenu: boolean
}

function shortcutLocations(config: SquirrelShortcutConfig): string[] {
  const locations: string[] = []
  if (config.desktop) locations.push('Desktop')
  if (config.startMenu) locations.push('StartMenu')
  return locations
}

/**
 * Resolve the installer action for Electron's current command line.
 * @param argv - Electron process arguments supplied by Squirrel.Windows.
 * @param executable - Packaged application executable path.
 * @param platform - Current Node platform.
 * @param shortcuts - Shortcut locations selected by the desktop build config.
 * @returns The Update.exe action, an immediate quit, or undefined for normal startup.
 */
export function squirrelLifecycleAction(
  argv: readonly string[],
  executable: string,
  platform: NodeJS.Platform,
  shortcuts: SquirrelShortcutConfig,
): SquirrelLifecycleAction | undefined {
  if (platform !== 'win32') return undefined
  const event = argv[1]
  if (event === '--squirrel-obsolete') return { kind: 'quit' }
  if (
    event !== '--squirrel-install'
    && event !== '--squirrel-updated'
    && event !== '--squirrel-uninstall'
  ) return undefined

  const locations = shortcutLocations(shortcuts)
  if (locations.length === 0) return { kind: 'quit' }
  const shortcutCommand = event === '--squirrel-uninstall' ? '--removeShortcut' : '--createShortcut'
  return {
    kind: 'run',
    executable: win32.resolve(win32.dirname(executable), '..', 'Update.exe'),
    args: [
      `${shortcutCommand}=${win32.basename(executable)}`,
      `--shortcut-locations=${locations.join(',')}`,
    ],
  }
}
