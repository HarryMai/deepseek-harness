import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import { describe, expect, it, onTestFinished } from 'vitest'
import DynamicCordisRunnerService from '../../cordis-host-runner/src/index.ts'
import { apply, Config, inject, name } from '../src/index.ts'
import { CORDIS_SYSTEM_PROMPT } from '../src/prompt.ts'

const AGENT = { id: 'cordis-tool-test' } as Agent

async function setup(dynamic?: boolean): Promise<Context> {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(Timer)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(DynamicCordisRunnerService)
  await ctx.plugin({ name, inject, apply, Config }, dynamic === undefined ? undefined : { dynamic })
  return ctx
}

function text(result: ToolExecutionResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

async function define(ctx: Context, arguments_: unknown): Promise<ToolExecutionResult> {
  const batch = await ctx.tools.execute({
    calls: [{
      type: 'tool-call',
      id: ToolCallId('define'),
      name: 'cordis_define',
      arguments: JSON.stringify(arguments_),
    }],
    agent: AGENT,
    signal: new AbortController().signal,
  })
  return batch.results[0]!.result
}

describe('cordis_define nested JSON recovery', () => {
  it('defines a package when both structured fields arrive as JSON text', async () => {
    const ctx = await setup()

    const result = await define(ctx, {
      plugin: JSON.stringify({ kind: 'new', idPrefix: 'whale' }),
      name: 'Whale overlay',
      purpose: 'Shows a calm whale in the Web UI.',
      code: JSON.stringify({ host: 'return { name: "whale", apply() {} }' }),
    })

    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Defined whale-1/pkg-1')
    expect(ctx.dynamicCordisRunner.inventory()).toMatchObject([{
      agentId: AGENT.id,
      packages: [{ name: 'Whale overlay', purpose: 'Shows a calm whale in the Web UI.' }],
    }])
  })

  it('keeps ordinary structured arguments valid', async () => {
    const ctx = await setup()

    const result = await define(ctx, {
      plugin: { kind: 'new', idPrefix: 'plain' },
      name: 'Plain package',
      purpose: 'Uses ordinary structured arguments.',
      code: { host: 'return { name: "plain", apply() {} }' },
    })

    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Defined plain-1/pkg-1')
  })

  it('rejects malformed or invalid JSON text after the compatibility branch admits it', async () => {
    const ctx = await setup()
    const common = {
      name: 'Broken package',
      purpose: 'Exercises the recovery failure.',
      code: { host: 'return { name: "broken", apply() {} }' },
    }

    const malformed = await define(ctx, { ...common, plugin: '{not JSON' })
    expect(malformed.isError).toBe(true)
    expect(text(malformed)).toContain('cordis_define `plugin` JSON text must encode valid JSON')

    const invalid = await define(ctx, {
      ...common,
      plugin: JSON.stringify({ kind: 'new', idPrefix: 'valid', extra: true }),
    })
    expect(invalid.isError).toBe(true)
    expect(text(invalid)).toContain('cordis_define `plugin` JSON text is invalid')
  })
})

describe('Cordis tool exposure', () => {
  it('keeps dynamic tools out of an inspection-only preset even when a runner is present', async () => {
    const ctx = await setup(false)
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['cordis_inspect'])
  })

  it('exposes the unified inspection and prior dynamic tools when enabled', async () => {
    const ctx = await setup()
    expect(ctx.tools.schemas().map(tool => tool.name).sort()).toEqual([
      'cordis_inspect', 'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self',
      'cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine',
    ].sort())
  })
})

it('recovers structured inspection input for both tool names without rewriting valid strings', async () => {
  const ctx = await setup()
  const objectSchema = { type: 'object', properties: { root: { type: 'string' } }, required: ['root'], additionalProperties: false }
  ctx.cordisInspect.register({
    manifest: {
      id: 'Example', description: 'Test queries.', methods: [
        { name: 'object', description: 'Read an object.', inputSchema: objectSchema, outputSchema: objectSchema },
        { name: 'text', description: 'Read text.', inputSchema: { type: 'string' }, outputSchema: { type: 'string' } },
      ],
    },
    async query(_method, input) { return input ?? null },
  })
  const exec = { agent: AGENT, signal: new AbortController().signal } as ToolRunContext
  const target = { platform: 'host', provider: 'Example', method: 'object' }
  const input = JSON.stringify({ root: 'tools' })
  for (const [name, args] of [
    ['cordis_inspect', { query: { ...target, input } }],
    ['cordis_inspect_query', { ...target, input }],
  ] as const) {
    expect(await ctx.tools.get(name)!.execute(args, exec)).toEqual({ ...target, data: { root: 'tools' } })
  }
  const unified = ctx.tools.get('cordis_inspect')!
  expect(await unified.execute({ query: { ...target, method: 'text', input } }, exec))
    .toEqual({ ...target, method: 'text', data: input })
  await expect(unified.execute({ query: { ...target, input: '{bad' } }, exec))
    .rejects.toMatchObject({ name: 'InspectError', code: 'INSPECT_INVALID_INPUT' })
})

it('runs and disposes the Host tool example included in the dynamic guidance', async () => {
  const ctx = await setup()
  const source = /### Host Tool example[\s\S]*?```js\n([\s\S]*?)\n```/u.exec(CORDIS_SYSTEM_PROMPT)?.[1]
  expect(source).toBeDefined()
  const receipt = ctx.dynamicCordisRunner.define({
    sessionId: AGENT.id,
    plugin: { kind: 'new', idPrefix: 'demo' },
    name: 'Reverse text',
    purpose: 'Reverse a string.',
    code: { host: source! },
  })
  const started = await ctx.dynamicCordisRunner.run(AGENT, receipt.pluginId, receipt.packageId, 'run')
  expect(started).toMatchObject({ ok: true, status: 'running' })
  const tool = ctx.tools.get('reverse_text')
  expect(tool).toBeDefined()
  const exec = { signal: new AbortController().signal } as ToolRunContext
  expect(await tool!.execute({ text: 'example' }, exec)).toBe('elpmaxe')
  await expect(ctx.dynamicCordisRunner.stop(AGENT, receipt.pluginId)).resolves.toMatchObject({ ok: true })
  expect(ctx.tools.get('reverse_text')).toBeUndefined()
})
