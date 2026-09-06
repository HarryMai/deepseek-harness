/** Target-specific native-module build commands used by desktop packaging. */

import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { DesktopBuildCommand } from './build-command.ts'

/**
 * Locate the node-gyp program bundled with the builder's Node installation.
 * @param nodeExecutable - Node executable whose bundled npm supplies node-gyp.
 * @returns Absolute path to node-gyp's JavaScript entrypoint.
 */
export function bundledNodeGypPath(nodeExecutable = process.execPath): string {
  const executableDirectory = dirname(realpathSync(nodeExecutable))
  const candidates = [
    resolve(executableDirectory, '..', 'lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js'),
    join(executableDirectory, 'node_modules/npm/node_modules/node-gyp/bin/node-gyp.js'),
  ]
  const nodeGyp = candidates.find(existsSync)
  if (nodeGyp !== undefined) return nodeGyp
  throw new Error(`desktop installer: Node installation does not bundle node-gyp: ${nodeExecutable}`)
}

/**
 * Build the command for a native module against one staged Node header tree.
 * @param nodeGyp - Absolute path to the node-gyp JavaScript entrypoint.
 * @param nodeHeaders - Extracted Node distribution directory containing include/node.
 * @param architecture - CPU architecture of the packaged Node runtime.
 * @param nodeExecutable - Node executable that runs node-gyp.
 * @returns Shell-free command and arguments for node-gyp rebuild.
 */
export function nativeModuleBuildCommand(
  nodeGyp: string,
  nodeHeaders: string,
  architecture: string,
  nodeExecutable = process.execPath,
): DesktopBuildCommand {
  return {
    command: nodeExecutable,
    args: [nodeGyp, 'rebuild', `--arch=${architecture}`, `--nodedir=${nodeHeaders}`],
  }
}

/**
 * Require the fs-ext binding produced for a staged Host runtime.
 * @param hostRuntime - Root of the staged ordinary-Node Host closure.
 * @returns Absolute path to the generated fs-ext binding.
 */
export function assertFsExtBinding(hostRuntime: string): string {
  const binding = join(hostRuntime, 'node_modules/fs-ext/build/Release/fs_ext.node')
  if (!existsSync(binding)) {
    throw new Error(`desktop installer: fs-ext native binding is missing after rebuild: ${binding}`)
  }
  return binding
}
