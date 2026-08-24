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

  it('passes stdio environment variables to the temporary client without returning them', async () => {
    const payload = fixturePayload() as { server: Record<string, unknown> }
    payload.server.env = { TOKEN: 'secret' }
    await expect(probeMcpConnection(payload, undefined, 15_000)).resolves.toEqual({ ok: true, toolCount: 6 })
  })

  it('does not start a transport after the browser cancels the request', async () => {
    const controller = new AbortController()
    controller.abort(new Error('test cancelled'))
    await expect(probeMcpConnection(fixturePayload(), controller.signal)).resolves.toEqual({ ok: false, reason: 'cancelled' })
  })
})
