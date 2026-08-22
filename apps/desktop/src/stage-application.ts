/** Self-contained application-bundle copies for installer staging. */

import { cp } from 'node:fs/promises'

/**
 * Copy a built application bundle for installer staging.
 * @param source - Built application bundle.
 * @param destination - Staged bundle directory.
 * @returns The staged bundle directory.
 */
export async function copyApplicationBundle(source: string, destination: string): Promise<string> {
  await cp(source, destination, {
    recursive: true,
    // Node resolves relative symlink targets to absolute builder paths by
    // default; the staged bundle must keep them relative to stay
    // self-contained when the disk image is installed on another machine.
    verbatimSymlinks: true,
  })
  return destination
}
