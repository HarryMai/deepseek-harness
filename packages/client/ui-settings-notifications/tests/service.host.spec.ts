/** Host lifecycle, trigger routing, multi-channel fan-out, and loopback RPC tests. */

import { Context, type Fiber } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  CustomerNotificationsService,
  DEFAULT_NOTIFICATION_CHANNEL,
  DEFAULT_NOTIFICATION_EVENTS,
  NOTIFICATIONS_RPC_CHANNEL,
  NOTIFICATIONS_TEST_ENDPOINT,
  type Config,
  type NotificationChannelSettings,
  type NotificationEventsConfig,
  type PushFetch,
} from '../src/index.ts'

interface PlainConfig {
  enabled: boolean
  timeoutMs: number
  events: NotificationEventsConfig
  channels: Record<string, NotificationChannelSettings>
}

function makeConfig(overrides: {
  enabled?: boolean
  timeoutMs?: number
  events?: Partial<NotificationEventsConfig>
  channels?: Record<string, NotificationChannelSettings>
} = {}): PlainConfig {
  return {
    enabled: overrides.enabled ?? true,
    timeoutMs: overrides.timeoutMs ?? 5000,
    events: {
      ...DEFAULT_NOTIFICATION_EVENTS,
      ...overrides.events,
    },
    channels: overrides.channels ?? {
      bark1: {
        ...DEFAULT_NOTIFICATION_CHANNEL,
        enabled: true,
        name: 'iPhone',
        serverUrl: 'https://api.day.app',
        deviceKey: 'key-iphone',
      },
    },
  }
}

function makeSession(id = 'session-1234567890', origin?: 'subagent'): Session {
  return {
    id: SessionId(id),
    header: {
      version: 4,
      id: SessionId(id),
      createdAt: 1,
      isSeeded: false,
      ...(origin === undefined ? {} : { origin }),
    },
  } as Session
}

function makeAgent(session: Session, pendingNextTurn = 0, pendingNextStep = 0): Agent {
  return {
    id: session.id,
    session,
    inbox: {
      nextTurn: Array.from({ length: pendingNextTurn }),
      nextStep: Array.from({ length: pendingNextStep }),
    },
  } as never as Agent
}

function createMockFetch() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  const fetchMock: PushFetch = vi.fn<PushFetch>(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const bodyText = typeof init?.body === 'string' ? init.body : '{}'
    calls.push({
      url,
      body: JSON.parse(bodyText) as Record<string, unknown>,
    })
    return new Response(JSON.stringify({ code: 200, message: 'success' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { calls, fetchMock }
}

async function mountService(
  root: Context,
  config: PlainConfig,
  fetchMock: PushFetch,
): Promise<{ mounted: CustomerNotificationsService; fiber: Fiber }> {
  class TestNotificationsService extends CustomerNotificationsService {
    constructor(pluginCtx: Context, pluginConfig: Config) {
      super(pluginCtx, pluginConfig, { fetch: fetchMock })
    }
  }
  const fiber = root.plugin(TestNotificationsService, config)
  await fiber.await()
  const mounted = root.get('customerNotifications')
  if (mounted === undefined) throw new Error('customerNotifications service not provided')
  return { mounted, fiber }
}

describe('CustomerNotificationsService', () => {
  it('triggers concise Bark pushes for approval, manual action, passive interruption, and task completion', async () => {
    const root = new Context()
    const config = makeConfig()
    const { calls, fetchMock } = createMockFetch()
    const session = makeSession('sess-alpha-001')
    const agent = makeAgent(session)

    root.provide('sessionTitle', {
      get: (target: Session) => target === session ? { title: '发布移动端通知' } : undefined,
    } as never)
    root.provide('agents', {
      get: (id: SessionId) => id === session.id ? agent : undefined,
    } as never)
    const { mounted } = await mountService(root, config, fetchMock)

    // 1. Human privilege escalation (`approval/request`) delegates cleanly via next()
    const outcome = await root.waterfall(
      'approval/request',
      { agent, toolName: 'bash', reason: 'run sudo' },
      async () => 'allowed-once' as const,
    )
    expect(outcome).toBe('allowed-once')

    // 1b. Blocking approval via `user-questions/request` (`intent: 'approval'`)
    const approvalAnswer = await root.waterfall(
      'user-questions/request',
      {
        agent,
        questions: [{
          id: 'perm',
          question: 'Allow app access?',
          detail: 'Control Finder',
          options: [{ label: 'Allow' }, { label: 'Reject' }],
          intent: { kind: 'approval', approve: 'Allow', reject: 'Reject', subject: { name: 'Finder' } },
        }],
      },
      async () => ({ answers: [{ id: 'perm', selected: ['Allow'] }] }),
    )
    expect(approvalAnswer.answers[0]?.selected).toEqual(['Allow'])

    // 2. Manual action (`user-questions/request` normal + plan-review)
    await root.waterfall(
      'user-questions/request',
      { agent, questions: [{ id: 'q1', question: 'Pick target env' }] },
      async () => ({ answers: [{ id: 'q1', selected: ['prod'] }] }),
    )
    await root.waterfall(
      'user-questions/request',
      {
        agent,
        questions: [{
          id: 'plan',
          question: 'Confirm plan?',
          detail: '# Plan',
          options: [{ label: 'Approve' }],
          intent: { kind: 'plan-review', approve: 'Approve' },
        }],
      },
      async () => ({ answers: [{ id: 'plan', selected: ['Approve'] }] }),
    )

    // 3. Passive non-user interruption (`turn/end` error)
    root.emit('session/event', session, {
      type: 'turn/start', seq: 0 as never, time: 1, data: { turn: 1 },
    } as SessionEvent)
    root.emit('session/event', session, {
      type: 'step/start', seq: 1 as never, time: 2, data: { turn: 1, step: 1 },
    } as SessionEvent)
    root.emit('session/event', session, {
      type: 'turn/end',
      seq: 2 as never,
      time: 3,
      data: { turn: 1, reason: { kind: 'error', error: { code: 'PROVIDER_TIMEOUT', message: 'timeout' } } },
    } as SessionEvent)

    // 4. Normal task completion (`turn/end` completed)
    root.emit('session/event', session, {
      type: 'turn/start', seq: 3 as never, time: 4, data: { turn: 2 },
    } as SessionEvent)
    root.emit('session/event', session, {
      type: 'step/start', seq: 4 as never, time: 5, data: { turn: 2, step: 1 },
    } as SessionEvent)
    root.emit('session/event', session, {
      type: 'turn/end', seq: 5 as never, time: 6, data: { turn: 2, reason: { kind: 'completed' } },
    } as SessionEvent)

    await mounted.flush()

    expect(calls.map(item => item.body.title)).toEqual([
      'DSH：需人工提权',
      'DSH：需人工提权',
      'DSH：需人工操作',
      'DSH：需人工操作',
      'DSH：任务被动中断',
      'DSH：任务已完成',
    ])
    expect(calls[0]?.body.body).toContain('bash')
    expect(calls[0]?.body.body).toContain('发布移动端通知')
    expect(calls[1]?.body.body).toContain('Finder')
    expect(calls[3]?.body.body).toContain('计划方案等待人工确认')
    expect(calls[4]?.body.body).toContain('PROVIDER_TIMEOUT')
    expect(calls[5]?.body.body).toContain('任务已正常完成')

    await root.fiber.dispose()
  })

  it('skips notifications for manual user cancellation, disposed/forked turns, subagents, empty turns, pending inbox, disabled switches', async () => {
    const root = new Context()
    const config = makeConfig()
    const { calls, fetchMock } = createMockFetch()
    const session = makeSession('sess-skip-001')
    const subSession = makeSession('sess-sub-001', 'subagent')
    let queuedNextTurn = 0
    const agent = makeAgent(session)
    Object.defineProperty(agent.inbox, 'nextTurn', { get: () => Array.from({ length: queuedNextTurn }) })

    root.provide('agents', {
      get: (id: SessionId) => id === session.id ? agent : undefined,
    } as never)

    const { mounted, fiber } = await mountService(root, config, fetchMock)

    // User cancellation must NOT notify
    root.emit('session/event', session, {
      type: 'turn/end', seq: 0 as never, time: 1,
      data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } },
    } as SessionEvent)

    // Disposed and forked must NOT notify
    root.emit('session/event', session, {
      type: 'turn/end', seq: 1 as never, time: 2,
      data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'disposed' } } },
    } as SessionEvent)
    root.emit('session/event', session, {
      type: 'turn/end', seq: 2 as never, time: 3,
      data: { turn: 3, reason: { kind: 'forked' } },
    } as SessionEvent)

    // Subagent turns must NOT notify
    root.emit('session/event', subSession, {
      type: 'turn/end', seq: 0 as never, time: 4,
      data: { turn: 1, reason: { kind: 'completed' } },
    } as SessionEvent)

    // Empty 0-step turn must NOT notify
    root.emit('session/event', session, {
      type: 'turn/start', seq: 3 as never, time: 5, data: { turn: 4 },
    } as SessionEvent)
    root.emit('session/event', session, {
      type: 'turn/end', seq: 4 as never, time: 6, data: { turn: 4, reason: { kind: 'completed' } },
    } as SessionEvent)

    // Turn with pending queued follow-up must NOT notify prematurely
    queuedNextTurn = 1
    root.emit('session/event', session, {
      type: 'turn/start', seq: 5 as never, time: 7, data: { turn: 5 },
    } as SessionEvent)
    root.emit('session/event', session, {
      type: 'step/start', seq: 6 as never, time: 8, data: { turn: 5, step: 1 },
    } as SessionEvent)
    root.emit('session/event', session, {
      type: 'turn/end', seq: 7 as never, time: 9, data: { turn: 5, reason: { kind: 'completed' } },
    } as SessionEvent)
    queuedNextTurn = 0

    // Per-event switch off
    await fiber.update({ ...config, events: { ...DEFAULT_NOTIFICATION_EVENTS, taskCompleted: false } })
    root.emit('session/event', session, {
      type: 'turn/end', seq: 8 as never, time: 10, data: { turn: 6, reason: { kind: 'completed' } },
    } as SessionEvent)

    // Master switch off
    await fiber.update({ ...config, enabled: false, events: { ...DEFAULT_NOTIFICATION_EVENTS } })
    root.emit('session/event', session, {
      type: 'turn/end', seq: 9 as never, time: 11, data: { turn: 7, reason: { kind: 'completed' } },
    } as SessionEvent)

    await mounted.flush()
    expect(calls).toHaveLength(0)

    // Re-enabling master switch immediately works without restart and falls back to session id prefix
    await fiber.update({ ...config, enabled: true, events: { ...DEFAULT_NOTIFICATION_EVENTS } })
    root.emit('session/event', session, {
      type: 'turn/end', seq: 10 as never, time: 12, data: { turn: 8, reason: { kind: 'completed' } },
    } as SessionEvent)
    await mounted.flush()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body.body).toContain('会话 sess-ski')

    root.emit('session/disposed', session)
    await root.fiber.dispose()
  })

  it('mounts loopback-only test RPC, supports custom providers, and isolates per-channel failures', async () => {
    const root = new Context()
    const config = makeConfig({
      channels: {
        good: {
          ...DEFAULT_NOTIFICATION_CHANNEL,
          enabled: true,
          name: 'Good',
          serverUrl: 'https://good.example.test',
          deviceKey: 'k1',
        },
        bad: {
          ...DEFAULT_NOTIFICATION_CHANNEL,
          enabled: true,
          name: 'Bad',
          serverUrl: 'https://bad.example.test',
          deviceKey: 'k2',
        },
        off: {
          ...DEFAULT_NOTIFICATION_CHANNEL,
          enabled: false,
          name: 'Off',
          serverUrl: 'https://off.example.test',
          deviceKey: 'k3',
        },
      },
    })

    const fetchMock: PushFetch = vi.fn<PushFetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('bad.example.test')) {
        return new Response('err', { status: 500 })
      }
      return new Response(JSON.stringify({ code: 200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    let rpcHandler:
      | ((endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<{ ok: boolean; value: unknown }>)
      | undefined
    let rpcAccess: unknown
    root.provide('connection', {
      rpc: {
        handle: (channel: string, handler: typeof rpcHandler, opts: { access: string }) => {
          expect(channel).toBe(NOTIFICATIONS_RPC_CHANNEL)
          rpcHandler = handler
          rpcAccess = opts.access
          return () => {}
        },
      },
    } as never)
    const configureMock = vi.fn(() => () => {})
    root.provide('settings', { configure: configureMock } as never)

    const { mounted } = await mountService(root, config, fetchMock)

    expect(configureMock).toHaveBeenCalledWith({ auto: false }, expect.anything())
    expect(rpcAccess).toBe('owner-loopback')
    expect(rpcHandler).toBeDefined()

    // Register a future custom provider dynamically
    const disposeCustom = mounted.registerProvider({
      provider: 'harmony',
      validate: () => undefined,
      send: async () => ({ ok: true }),
    })
    expect(mounted.providers()).toEqual(['bark', 'harmony'])
    await disposeCustom()
    expect(mounted.providers()).toEqual(['bark'])

    // Unknown endpoint and invalid payload return browser-safe failures
    expect(await rpcHandler!('unknown', {})).toEqual({ ok: true, value: { ok: false, reason: 'unavailable' } })
    expect(await rpcHandler!(NOTIFICATIONS_TEST_ENDPOINT, { channel: {} })).toEqual({
      ok: true,
      value: { ok: false, reason: 'invalid-configuration' },
    })

    // Valid test push succeeds through loopback RPC without enabling the channel
    expect(await rpcHandler!(NOTIFICATIONS_TEST_ENDPOINT, {
      channel: {
        ...DEFAULT_NOTIFICATION_CHANNEL,
        enabled: false,
        name: 'Test Device',
        serverUrl: 'https://good.example.test',
        deviceKey: 'test-key',
      },
    })).toEqual({ ok: true, value: { ok: true, statusCode: 200 } })

    // Fan-out hits both enabled channels and contains bad channel HTTP 500
    const session = makeSession('sess-fanout-1')
    root.emit('session/event', session, {
      type: 'turn/end', seq: 0 as never, time: 1, data: { turn: 1, reason: { kind: 'completed' } },
    } as SessionEvent)
    await mounted.flush()
    expect(fetchMock).toHaveBeenCalledTimes(3) // 1 test + 2 enabled channels (off channel skipped)

    await root.fiber.dispose()
    expect(await mounted.testChannel({
      ...DEFAULT_NOTIFICATION_CHANNEL,
      serverUrl: 'https://good.example.test',
      deviceKey: 'k',
    })).toEqual({ ok: false, reason: 'unavailable' })
  })
})
