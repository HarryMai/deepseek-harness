import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { describe, expect, it } from 'vitest'
import { CordisInspectRegistryService } from '../src/inspect-registry.ts'
import type { CordisInspectMethodManifest } from '../src/types.ts'

const AGENT = { id: 'inspect-session' } as Agent
const SIGNAL = new AbortController().signal

const OBJECT_METHOD: CordisInspectMethodManifest = {
  name: 'read',
  description: 'Read one named object.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['root'],
    properties: { root: { type: 'string' } },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['root'],
    properties: { root: { type: 'string' } },
  },
}

describe('Cordis inspect nested JSON recovery', () => {
  it('normalizes valid JSON text before forwarding a Host query', async () => {
    const registry = new CordisInspectRegistryService(new Context())
    const seen: JsonValue[] = []
    registry.register({
      manifest: { id: 'probe', description: 'Probe provider.', methods: [OBJECT_METHOD] },
      async query(_method, input) {
        if (input === undefined) throw new Error('expected normalized input')
        seen.push(input)
        return input
      },
    })

    await expect(registry.query('host', 'probe', 'read', '{"root":"shell.overlay"}', AGENT, SIGNAL))
      .resolves.toEqual({ root: 'shell.overlay' })
    expect(seen).toEqual([{ root: 'shell.overlay' }])
  })

  it('normalizes valid JSON text before forwarding a Client query', async () => {
    const ctx = new Context()
    const registry = new CordisInspectRegistryService(ctx)
    registry.syncClientManifest([{ id: 'slots', description: 'Slot provider.', methods: [OBJECT_METHOD] }])
    let seen: JsonValue | undefined
    ctx.on('cordis/inspect-query', (request) => {
      seen = request.input
      registry.resolveClientQuery(AGENT, request.requestId, {
        ok: true,
        data: request.input ?? null,
      })
    })

    await expect(registry.query('client', 'slots', 'read', '{"root":"shell.overlay"}', AGENT, SIGNAL))
      .resolves.toEqual({ root: 'shell.overlay' })
    expect(seen).toEqual({ root: 'shell.overlay' })
  })

  it('preserves a valid string input without decoding it', async () => {
    const registry = new CordisInspectRegistryService(new Context())
    const jsonText = '{"root":"shell.overlay"}'
    registry.register({
      manifest: {
        id: 'text',
        description: 'Text provider.',
        methods: [{
          name: 'read',
          description: 'Read text.',
          inputSchema: { type: 'string' },
          outputSchema: { type: 'string' },
        }],
      },
      async query(_method, input) {
        return input ?? ''
      },
    })

    await expect(registry.query('host', 'text', 'read', jsonText, AGENT, SIGNAL)).resolves.toBe(jsonText)
  })

  it('keeps the original schema failure when JSON text is malformed or still invalid', async () => {
    const registry = new CordisInspectRegistryService(new Context())
    registry.register({
      manifest: { id: 'probe', description: 'Probe provider.', methods: [OBJECT_METHOD] },
      async query() {
        return { root: 'unreachable' }
      },
    })

    await expect(registry.query('host', 'probe', 'read', '{"root":7}', AGENT, SIGNAL))
      .rejects.toThrow('"input" must be an object')
    await expect(registry.query('host', 'probe', 'read', 'not JSON', AGENT, SIGNAL))
      .rejects.toThrow('"input" must be an object')
  })
})
