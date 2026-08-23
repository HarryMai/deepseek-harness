import { describe, expect, it } from 'vitest'
import { resolveDesktopWebInvocation } from '../src/desktop-host.ts'

describe('desktop Web profile invocation', () => {
  it('keeps launcher patches separate from Web arguments', () => {
    expect(resolveDesktopWebInvocation([
      '--patch', './first.yml',
      '--patch', './second.yml',
      '--port', '3080',
    ])).toEqual({
      patchFiles: ['./first.yml', './second.yml'],
      args: ['--host', '127.0.0.1', '--port', '0', '--no-open', '--port', '3080'],
    })
  })

  it('passes the fixed no-open default to the Web profile', () => {
    expect(resolveDesktopWebInvocation([])).toEqual({
      patchFiles: [],
      args: ['--host', '127.0.0.1', '--port', '0', '--no-open'],
    })
  })
})
