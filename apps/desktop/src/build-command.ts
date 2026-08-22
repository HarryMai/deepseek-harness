/** Shell-free package-manager commands used by desktop packaging. */

/** Executable and arguments for one child process. */
export interface DesktopBuildCommand {
  readonly command: string
  readonly args: string[]
}

/**
 * Build a shell-free invocation of the pnpm process that launched the package script.
 * @param args - Arguments passed to the pnpm JavaScript entrypoint.
 * @param environment - Package-script environment containing `npm_execpath`.
 * @param nodeExecutable - Ordinary Node executable used to run pnpm.
 * @returns A command that works without the Windows `pnpm.cmd` shim.
 */
export function pnpmBuildCommand(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  nodeExecutable = process.execPath,
): DesktopBuildCommand {
  const entrypoint = environment.npm_execpath
  if (entrypoint === undefined || entrypoint.trim() === '') {
    throw new Error(
      'desktop installer: npm_execpath is unavailable; invoke the builder through `pnpm desktop:make:*` scripts',
    )
  }
  if (!/\.[cm]?js$/u.test(entrypoint)) return { command: entrypoint, args: [...args] }
  return { command: nodeExecutable, args: [entrypoint, ...args] }
}
