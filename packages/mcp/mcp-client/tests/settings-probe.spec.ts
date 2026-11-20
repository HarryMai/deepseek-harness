/** One-shot MCP connection checks used by the Custom Configuration page. */

import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { Client } from '@modelcontextprotocol/client'
import { describe, expect, it, vi } from 'vitest'
import { apply, probeMcpConnection } from '@deepseek-ai/dsh-mcp-client/src/probe.ts'

const fixtureServerPath = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))

function fixturePayload(cwd = process.cwd()): unknown {
  return {
    server: {
      enabled: false,
      transport: 'stdio',
      serverName: 'probe_fixture',
      command: process.execPath,
      args: [fixtureServerPath],
      cwd,
      url: '',
    },
  }
}

describe('mcp-client one-shot settings probe', () => {
  it('registers its RPC channel as owner-loopback only', async () => {
    const ctx = new Context()
    const handle = vi.fn(() => () => {})
    ctx.provide('connection', { rpc: { handle } } as never)
    try {
      await ctx.plugin({ name: 'mcp-settings-probe-test', apply }, {})
      expect(handle).toHaveBeenCalledWith('/mcp-settings', expect.any(Function), { access: 'owner-loopback' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reports missing-cwd when a stdio server record has no working directory', async () => {
    await expect(probeMcpConnection(fixturePayload(''), undefined, 15_000)).resolves.toEqual({ ok: false, reason: 'missing-cwd' })
  })

  it('initializes a temporary stdio client, lists tools, and reports only the count', async () => {
    await expect(probeMcpConnection(fixturePayload(), undefined, 15_000)).resolves.toEqual({ ok: true, toolCount: 6 })
  }, 30_000)

  it('passes stdio environment variables to the temporary client without returning them', async () => {
    const payload = fixturePayload() as { server: Record<string, unknown> }
    payload.server.env = { TOKEN: 'secret' }
    await expect(probeMcpConnection(payload, undefined, 15_000)).resolves.toEqual({ ok: true, toolCount: 6 })
  })

  it('reports failure when closing the temporary client fails', async () => {
    // oxlint-disable-next-line typescript/unbound-method -- the spy forwards each call with its original client receiver.
    const close = Client.prototype.close
    const spy = vi.spyOn(Client.prototype, 'close').mockImplementation(async function (this: Client) {
      await close.call(this)
      throw new Error('fixture close failure')
    })
    try {
      await expect(probeMcpConnection(fixturePayload(), undefined, 15_000)).resolves.toEqual({ ok: false, reason: 'connection-failed' })
    } finally {
      spy.mockRestore()
    }
  })

  it('does not start a transport after the browser cancels the request', async () => {
    const controller = new AbortController()
    controller.abort(new Error('test cancelled'))
    await expect(probeMcpConnection(fixturePayload(), controller.signal)).resolves.toEqual({ ok: false, reason: 'cancelled' })
  })
})
