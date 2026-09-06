import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertFsExtBinding, bundledNodeGypPath, nativeModuleBuildCommand } from '../src/native-module.ts'

const directories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-native-module-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop native module staging', () => {
  it('uses the target architecture and extracted Node headers', () => {
    expect(nativeModuleBuildCommand('/tools/node-gyp.js', '/runtime-headers', 'arm64', '/tools/node'))
      .toEqual({
        command: '/tools/node',
        args: [
          '/tools/node-gyp.js',
          'rebuild',
          '--arch=arm64',
          '--nodedir=/runtime-headers',
        ],
      })
  })

  it('locates node-gyp bundled beside the builder Node installation', () => {
    const prefix = temporaryDirectory()
    const nodeExecutable = join(prefix, 'bin/node')
    const nodeGyp = join(prefix, 'lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js')
    mkdirSync(join(prefix, 'bin'), { recursive: true })
    mkdirSync(join(prefix, 'lib/node_modules/npm/node_modules/node-gyp/bin'), { recursive: true })
    writeFileSync(nodeExecutable, '')
    writeFileSync(nodeGyp, '')

    expect(bundledNodeGypPath(nodeExecutable)).toBe(realpathSync(nodeGyp))
  })

  it('rejects a builder Node installation without node-gyp', () => {
    const prefix = temporaryDirectory()
    const nodeExecutable = join(prefix, 'bin/node')
    mkdirSync(join(prefix, 'bin'), { recursive: true })
    writeFileSync(nodeExecutable, '')

    expect(() => bundledNodeGypPath(nodeExecutable)).toThrow(/does not bundle node-gyp/)
  })

  it('requires fs-ext to produce its native binding', () => {
    const hostRuntime = temporaryDirectory()
    expect(() => assertFsExtBinding(hostRuntime)).toThrow(/fs-ext native binding is missing/)

    const binding = join(hostRuntime, 'node_modules/fs-ext/build/Release/fs_ext.node')
    mkdirSync(join(hostRuntime, 'node_modules/fs-ext/build/Release'), { recursive: true })
    writeFileSync(binding, '')

    expect(assertFsExtBinding(hostRuntime)).toBe(binding)
  })
})
