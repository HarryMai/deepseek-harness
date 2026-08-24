import { Context } from '@deepseek-ai/cordis'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import DynamicCordisRunnerService from '../../cordis-host-runner/src/index.ts'
import { apply, inject, name } from '../src/index.ts'

const AGENT = { id: 'cordis-tool-test' } as Agent

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(DynamicCordisRunnerService)
  await ctx.plugin({ name, inject, apply })
  return ctx
}

function text(result: ToolExecutionResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

async function define(ctx: Context, arguments_: unknown): Promise<ToolExecutionResult> {
  return await ctx.tools.execute({
    callId: CallId('define'),
    name: 'cordis_define',
    arguments: arguments_,
    agent: AGENT,
    signal: new AbortController().signal,
  })
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
