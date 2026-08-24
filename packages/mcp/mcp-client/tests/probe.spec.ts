/** One-shot MCP connection checks used by the Custom Configuration page. */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { probeMcpConnection } from '@deepseek-ai/dsh-mcp-client/src/probe.ts'

const fixtureServerPath = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))

function fixturePayload(): unknown {
  return {
    server: {
      enabled: false,
      transport: 'stdio',
      serverName: 'probe_fixture',
      command: process.execPath,
      args: [fixtureServerPath],
      cwd: '',
      url: '',
    },
  }
}

describe('mcp-client one-shot settings probe', () => {
  it('initializes a temporary stdio client, lists tools, and reports only the count', async () => {
    await expect(probeMcpConnection(fixturePayload(), undefined, 15_000)).resolves.toEqual({ ok: true, toolCount: 6 })
  }, 30_000)

  it('rejects payload fields that saved MCP settings cannot safely represent', async () => {
    await expect(probeMcpConnection({
      server: {
        enabled: false,
        transport: 'stdio',
        serverName: 'bad_probe',
        command: 'codegraph',
        args: [],
        cwd: '',
        url: '',
        env: { TOKEN: 'secret' },
      },
    }, undefined)).resolves.toEqual({ ok: false, reason: 'invalid-configuration' })
  })

  it('does not start a transport after the browser cancels the request', async () => {
    const controller = new AbortController()
    controller.abort(new Error('test cancelled'))
    await expect(probeMcpConnection(fixturePayload(), controller.signal)).resolves.toEqual({ ok: false, reason: 'cancelled' })
  })
})
