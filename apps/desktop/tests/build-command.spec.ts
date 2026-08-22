import { describe, expect, it } from 'vitest'
import { pnpmBuildCommand } from '../src/build-command.ts'

describe('desktop build child commands', () => {
  it('runs the lifecycle pnpm entrypoint through ordinary Node', () => {
    expect(pnpmBuildCommand(
      ['run', 'build'],
      { npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\pnpm\\bin\\pnpm.cjs' },
      'C:\\Program Files\\nodejs\\node.exe',
    )).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [
        'C:\\Program Files\\nodejs\\node_modules\\pnpm\\bin\\pnpm.cjs',
        'run',
        'build',
      ],
    })
  })

  it('runs native package-manager launchers directly', () => {
    expect(pnpmBuildCommand(
      ['run', 'build'],
      { npm_execpath: '/Users/ming/Library/pnpm/pnpm' },
      '/usr/local/bin/node',
    )).toEqual({
      command: '/Users/ming/Library/pnpm/pnpm',
      args: [
        'run',
        'build',
      ],
    })
  })

  it('rejects launchers that bypass the pnpm package script', () => {
    expect(() => pnpmBuildCommand(['run', 'build'], {}, process.execPath))
      .toThrow(/invoke the builder through `pnpm desktop:make:\*` scripts/)
  })
})
