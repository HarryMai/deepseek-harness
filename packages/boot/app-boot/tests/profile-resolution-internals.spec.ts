/** Electron exposes Node internals directly; its runtime fingerprint may not match the native addon. */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

it('uses exposed Node internals without loading the builtin-access addon', () => {
  const resolverUrl = pathToFileURL(join(packageRoot, 'src/profile-resolution/resolver.ts')).href
  const childSource = `
    import Module from 'node:module'
    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
      if (request === 'node-addon-require-builtin') throw new Error('builtin-access addon was loaded')
      return originalLoad.call(this, request, parent, isMain)
    }
    try {
      const { installRuntimeInterception } = await import(${JSON.stringify(resolverUrl)})
      const interception = installRuntimeInterception({
        profilesDir: process.cwd(),
        profileDir: undefined,
        localPackageNames: [],
        entries: [],
        linkedRoots: [],
      })
      interception.dispose()
    } finally {
      Module._load = originalLoad
    }
  `
  const result = spawnSync(process.execPath, [
    '--expose-internals', '--import', 'tsx/esm', '--input-type=module', '--eval', childSource,
  ], { cwd: packageRoot, encoding: 'utf8', timeout: 20_000 })

  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
})
