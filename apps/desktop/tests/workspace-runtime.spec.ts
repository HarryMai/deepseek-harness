import { describe, expect, it } from 'vitest'
import {
  runtimePackageRoots,
  workspaceRuntimeClosure,
  type WorkspaceRuntimePackage,
} from '../src/workspace-runtime.ts'

function workspacePackage(
  name: string,
  fields: Partial<WorkspaceRuntimePackage['manifest']> = {},
): WorkspaceRuntimePackage {
  return { path: `C:\\workspace\\${name}`, manifest: { name, files: ['lib'], ...fields } }
}

describe('desktop workspace runtime closure', () => {
  it('follows local runtime, optional, and peer dependencies only', () => {
    const packages = new Map([
      ['app', workspacePackage('app', {
        dependencies: { provider: 'workspace:^', external: '^1.0.0' },
        optionalDependencies: { optional: 'workspace:^' },
      })],
      ['provider', workspacePackage('provider', { peerDependencies: { service: 'workspace:^' } })],
      ['optional', workspacePackage('optional')],
      ['service', workspacePackage('service')],
      ['unused', workspacePackage('unused')],
    ])
    expect(workspaceRuntimeClosure('app', packages).map(value => value.manifest.name))
      .toEqual(['app', 'optional', 'provider', 'service'])
  })

  it('selects runtime roots from positive package files entries', () => {
    expect(runtimePackageRoots({
      name: 'provider',
      files: ['lib/index.js', 'config', '!lib/*.map', 'cordis.patch.yml'],
    })).toEqual(['config', 'cordis.patch.yml', 'lib', 'package.json'])
    expect(() => runtimePackageRoots({ name: 'provider' })).toThrow(/has no files list/)
  })
})
