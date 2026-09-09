import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const verifier = fileURLToPath(new URL('./verify-built-package-invariants.mjs', import.meta.url))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(options: {
  companion?: boolean
  invariantSource?: string
  invariantExport?: string
  runtimeChunk?: string
  runtimeChunkDeclared?: boolean
  entrySource?: string
  entryDeclared?: boolean
} = {}): { root: string; loaderUrl: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-built-package-invariants-'))
  roots.push(root)
  const packageDir = join(root, 'packages/core/probe')
  mkdirSync(join(packageDir, 'lib'), { recursive: true })
  const companion = options.companion ?? true
  const files = companion ? ['lib/invariant.js'] : []
  if (options.entryDeclared) files.push('lib/index.js')
  if (options.runtimeChunkDeclared) files.push('lib/chunk.js')
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-probe',
    type: 'module',
    files,
    exports: companion ? {
      './invariant': {
        default: options.invariantExport ?? './lib/invariant.js',
      },
    } : {},
  }, null, 2)}\n`)
  if (companion) {
    writeFileSync(
      join(packageDir, 'lib/invariant.js'),
      options.invariantSource ?? "export const name = 'probe-invariant'\nexport const inject = ['invariants']\nexport const apply = () => {}\n",
    )
  }
  if (options.runtimeChunk !== undefined) {
    writeFileSync(join(packageDir, 'lib/chunk.js'), options.runtimeChunk)
  }
  if (options.entrySource !== undefined) {
    writeFileSync(join(packageDir, 'lib/index.js'), options.entrySource)
  }
  const loaderPath = join(root, 'loader.mjs')
  writeFileSync(loaderPath, 'export default class Loader { unwrapExports(value) { return value } }\n')
  return { root, loaderUrl: pathToFileURL(loaderPath).href }
}

function verify(root: string, loaderUrl: string, timeout: number) {
  const result = spawnSync(process.execPath, [
    verifier,
    '--packages-root', root,
    '--loader-url', loaderUrl,
  ], {
    encoding: 'utf8',
    // Plain-Node startup and staged imports share the runner's platform budget.
    timeout,
  })
  expect(result.error).toBeUndefined()
  expect(result.signal, result.stderr).toBeNull()
  return result
}

describe('built package invariant verifier', () => {
  it('loads the staged compiled self-reference through plain Node and Loader normalization', ({ task }) => {
    const { root, loaderUrl } = fixture()
    const result = verify(root, loaderUrl, task.timeout)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('1 compiled companion(s) passed plain-Node Loader checks')
  })

  it('accepts packages that do not publish a companion', ({ task }) => {
    const { root, loaderUrl } = fixture({ companion: false })
    const result = verify(root, loaderUrl, task.timeout)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('0 compiled companion(s) passed plain-Node Loader checks')
  })

  it('rejects a default export and a broken invariant export map', ({ task }) => {
    const withDefault = fixture({
      invariantSource: "export default {}\nexport const name = 'probe-invariant'\nexport const inject = ['invariants']\nexport const apply = () => {}\n",
    })
    const defaultResult = verify(withDefault.root, withDefault.loaderUrl, task.timeout)
    expect(defaultResult.status).toBe(1)
    expect(defaultResult.stderr).toContain('companion has a default export')

    const brokenExport = fixture({ invariantExport: './lib/missing.js' })
    const exportResult = verify(brokenExport.root, brokenExport.loaderUrl, task.timeout)
    expect(exportResult.status).toBe(1)
    expect(exportResult.stderr).toContain('@deepseek-ai/dsh-probe')
  })

  it('rejects an invariant bundle that needs an unstaged runtime chunk', ({ task }) => {
    const { root, loaderUrl } = fixture({
      invariantSource: "export * from './chunk.js'\n",
      runtimeChunk: "export const name = 'probe-invariant'\nexport const inject = ['invariants']\nexport const apply = () => {}\n",
    })
    const result = verify(root, loaderUrl, task.timeout)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('chunk.js')
  })

  it('checks declared lib entries even when a package has no companion', () => {
    const { root, loaderUrl } = fixture({
      companion: false,
      entryDeclared: true,
      entrySource: "export * from './chunk.js'\n",
      runtimeChunk: "export const value = 'chunk'\n",
    })
    const result = verify(root, loaderUrl)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('lib/index.js -> ./chunk.js')
  })

  it('accepts a non-companion entry when its runtime chunk is declared', () => {
    const { root, loaderUrl } = fixture({
      companion: false,
      entryDeclared: true,
      entrySource: "export * from './chunk.js'\n",
      runtimeChunk: "export const value = 'chunk'\n",
      runtimeChunkDeclared: true,
    })
    const result = verify(root, loaderUrl)
    expect(result.status, result.stderr).toBe(0)
  })
})
