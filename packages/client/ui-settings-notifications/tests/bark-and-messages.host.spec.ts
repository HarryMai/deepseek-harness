/** Unit tests for Bark provider adapter, provider registry, validation helpers, and concise message builders. */

import { describe, expect, it, vi } from 'vitest'
import {
  BarkPushAdapter,
  DEFAULT_NOTIFICATION_CHANNEL,
  DEFAULT_NOTIFICATION_SETTINGS,
  PushProviderRegistry,
  buildApprovalMessage,
  buildBarkPayload,
  buildManualActionMessage,
  buildPassiveInterruptionMessage,
  buildTaskCompletedMessage,
  buildTestPushMessage,
  channelIssue,
  classifyUserQuestionRequest,
  cloneNotificationSettings,
  compactLabel,
  isValidHttpUrl,
  normalizeNotificationSettings,
  parseTestChannelPayload,
  passiveInterruptionReason,
  resolveBarkPushEndpoint,
  type NotificationChannelSettings,
  type PushFetch,
} from '../src/index.ts'

function barkChannel(overrides: Partial<NotificationChannelSettings> = {}): NotificationChannelSettings {
  return {
    ...DEFAULT_NOTIFICATION_CHANNEL,
    enabled: true,
    name: 'My iPhone',
    serverUrl: 'https://api.day.app',
    deviceKey: 'secret-device-key',
    group: 'DSH',
    ...overrides,
  }
}

describe('types and validation helpers', () => {
  it('validates HTTP/HTTPS URLs and channel completeness', () => {
    expect(isValidHttpUrl('https://api.day.app')).toBe(true)
    expect(isValidHttpUrl('http://127.0.0.1:8080/bark')).toBe(true)
    expect(isValidHttpUrl('')).toBe(false)
    expect(isValidHttpUrl('https://api.day.app/\0bad')).toBe(false)
    expect(isValidHttpUrl('ftp://api.day.app')).toBe(false)
    expect(isValidHttpUrl('not a url')).toBe(false)

    expect(channelIssue(barkChannel({ enabled: false }), true)).toBe('disabled')
    expect(channelIssue(barkChannel({ enabled: false }), false)).toBeUndefined()
    expect(channelIssue(barkChannel({ serverUrl: '' }), true)).toBe('missing-server-url')
    expect(channelIssue(barkChannel({ serverUrl: 'ws://bark.local' }), true)).toBe('invalid-server-url')
    expect(channelIssue(barkChannel({ deviceKey: '   ' }), true)).toBe('missing-device-key')
    expect(channelIssue(barkChannel({ provider: 'xiaomi' as never }), true)).toBe('unsupported-provider')
    expect(channelIssue(barkChannel(), true)).toBeUndefined()
  })

  it('normalizes partial settings and parses untrusted RPC payloads', () => {
    expect(normalizeNotificationSettings(undefined)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
    const normalized = normalizeNotificationSettings({
      enabled: true,
      events: {
        approvalRequired: false,
        manualActionRequired: true,
        passiveInterruption: false,
        taskCompleted: true,
      },
      channels: {
        c1: {
          enabled: true,
          provider: 'bark',
          name: 'Phone',
          serverUrl: 'https://api.day.app',
          deviceKey: 'key-1',
          group: 'Work',
          sound: 'minuet',
          level: 'timeSensitive',
        },
        c2: {
          enabled: 'bad' as never,
          provider: 'other' as never,
          name: 1 as never,
          serverUrl: 2 as never,
          deviceKey: 3 as never,
          group: 4 as never,
          sound: 5 as never,
          level: 'invalid' as never,
        },
      },
    })
    expect(normalized.enabled).toBe(true)
    expect(normalized.events.approvalRequired).toBe(false)
    expect(normalized.channels['c1']?.level).toBe('timeSensitive')
    expect(normalized.channels['c2']).toEqual({
      enabled: false,
      provider: 'bark',
      name: '',
      serverUrl: '',
      deviceKey: '',
      group: 'DSH',
      sound: '',
      level: '',
    })

    const cloned = cloneNotificationSettings(normalized)
    cloned.events.taskCompleted = false
    expect(normalized.events.taskCompleted).toBe(true)

    expect(parseTestChannelPayload(null)).toBeUndefined()
    expect(parseTestChannelPayload({ channel: { ...barkChannel(), extra: 1 } })).toBeUndefined()
    expect(parseTestChannelPayload({ channel: { ...barkChannel(), enabled: 'yes' } })).toBeUndefined()
    expect(parseTestChannelPayload({ channel: { ...barkChannel(), deviceKey: '' } })).toBeUndefined()
    expect(parseTestChannelPayload({ channel: barkChannel({ serverUrl: ' https://api.day.app ' }) })).toMatchObject({
      serverUrl: 'https://api.day.app',
      deviceKey: 'secret-device-key',
    })
  })
})

describe('concise push messages', () => {
  it('formats short labels and builds concise reason+content messages without verbose body text', () => {
    expect(compactLabel('   ', '默认')).toBe('默认')
    expect(compactLabel('a'.repeat(80), '默认').length).toBe(60)
    expect(compactLabel('a'.repeat(80), '默认').endsWith('…')).toBe(true)

    const approval = buildApprovalMessage({ taskLabel: '修复登录接口', toolName: 'bash', timestamp: 100 })
    expect(approval.event).toBe('approvalRequired')
    expect(approval.title).toBe('DSH：需人工提权')
    expect(approval.body).toContain('bash')
    expect(approval.body).toContain('修复登录接口')
    expect(approval.defaultLevel).toBe('timeSensitive')

    const genericApproval = buildApprovalMessage({ timestamp: 101 })
    expect(genericApproval.body).toContain('当前任务')

    const manual = buildManualActionMessage({ taskLabel: '重构路由', isPlanReview: false, timestamp: 102 })
    expect(manual.title).toBe('DSH：需人工操作')
    expect(manual.body).toContain('重构路由')

    const plan = buildManualActionMessage({ taskLabel: '架构方案', isPlanReview: true, timestamp: 103 })
    expect(plan.body).toContain('计划方案等待人工确认')

    const interrupted = buildPassiveInterruptionMessage({
      reasonText: '任务执行异常中断',
      taskLabel: '批量迁移',
      timestamp: 104,
    })
    expect(interrupted.title).toBe('DSH：任务被动中断')
    expect(interrupted.body).toContain('任务执行异常中断')

    const completed = buildTaskCompletedMessage({ taskLabel: '部署脚本', timestamp: 105 })
    expect(completed.title).toBe('DSH：任务已完成')
    expect(completed.defaultLevel).toBe('active')

    const testPush = buildTestPushMessage('我的手机', 106)
    expect(testPush.event).toBe('test')
    expect(testPush.body).toContain('我的手机')
  })

  it('classifies user-questions intents and filters passive interruptions from user/disposed/forked endings', () => {
    expect(classifyUserQuestionRequest({
      questions: [{
        id: 'q1',
        question: 'Allow?',
        detail: 'scope',
        options: [{ label: 'Allow' }, { label: 'Deny' }],
        intent: { kind: 'approval', approve: 'Allow', reject: 'Deny' },
      }],
    })).toBe('approval')
    expect(classifyUserQuestionRequest({
      questions: [{
        id: 'q1',
        question: 'Approve plan?',
        detail: '# Plan',
        options: [{ label: 'Approve' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }],
    })).toBe('plan-review')
    expect(classifyUserQuestionRequest({
      questions: [{ id: 'q1', question: 'Which branch?' }],
    })).toBe('action')

    expect(passiveInterruptionReason({ kind: 'error', error: { code: 'RATE_LIMITED', message: '429' } })).toContain('RATE_LIMITED')
    expect(passiveInterruptionReason({ kind: 'error', error: { code: 'UNKNOWN', message: 'boom' } })).toBe('任务执行异常中断')
    expect(passiveInterruptionReason({ kind: 'max-tokens' })).toBe('达到模型输出上限，任务中断')
    expect(passiveInterruptionReason({ kind: 'blocked' })).toBe('任务被策略或钩子拦截中断')
    expect(passiveInterruptionReason({ kind: 'interrupted' })).toBe('任务意外中断')
    expect(passiveInterruptionReason({ kind: 'aborted', reason: { kind: 'hook', reason: 'guard' } })).toBe('任务被钩子中止')
    expect(passiveInterruptionReason({ kind: 'aborted', reason: { kind: 'parent' } })).toBe('任务被上级中止')
    expect(passiveInterruptionReason({ kind: 'aborted', reason: { kind: 'legacy' } })).toBe('任务被动中止')
    expect(passiveInterruptionReason({ kind: 'aborted', reason: { kind: 'user' } })).toBeUndefined()
    expect(passiveInterruptionReason({ kind: 'aborted', reason: { kind: 'disposed' } })).toBeUndefined()
    expect(passiveInterruptionReason({ kind: 'completed' })).toBeUndefined()
    expect(passiveInterruptionReason({ kind: 'forked' })).toBeUndefined()
    expect(passiveInterruptionReason({ kind: 'custom-unknown' } as never)).toBeUndefined()
  })
})

describe('BarkPushAdapter and PushProviderRegistry', () => {
  it('resolves Bark endpoints without doubling /push and builds JSON payloads', () => {
    expect(resolveBarkPushEndpoint('https://api.day.app')).toBe('https://api.day.app/push')
    expect(resolveBarkPushEndpoint('https://api.day.app/')).toBe('https://api.day.app/push')
    expect(resolveBarkPushEndpoint('https://bark.example.com/prefix/')).toBe('https://bark.example.com/prefix/push')
    expect(resolveBarkPushEndpoint('https://bark.example.com/push')).toBe('https://bark.example.com/push')

    const message = buildTaskCompletedMessage({ taskLabel: '测试任务', timestamp: 1 })
    expect(buildBarkPayload(barkChannel({ group: '', sound: 'minuet', level: '' }), message)).toEqual({
      device_key: 'secret-device-key',
      title: message.title,
      body: message.body,
      group: 'DSH',
      level: 'active',
      sound: 'minuet',
    })
    expect(buildBarkPayload(barkChannel({ group: 'Alerts', sound: '', level: 'passive' }), message)).toEqual({
      device_key: 'secret-device-key',
      title: message.title,
      body: message.body,
      group: 'Alerts',
      level: 'passive',
    })
  })

  it('delivers via HTTP POST JSON and maps Bark codes, HTTP errors, timeouts, and aborts cleanly', async () => {
    const adapter = new BarkPushAdapter()
    const message = buildTestPushMessage('iPhone', 1)

    expect(await adapter.send(barkChannel({ deviceKey: '' }), message, { timeoutMs: 1000 })).toEqual({
      ok: false,
      reason: 'invalid-configuration',
    })

    const preAborted = new AbortController()
    preAborted.abort()
    expect(await adapter.send(barkChannel(), message, { timeoutMs: 1000, signal: preAborted.signal })).toEqual({
      ok: false,
      reason: 'cancelled',
    })

    const fetchOk = vi.fn<PushFetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      expect(url).toBe('https://api.day.app/push')
      expect(init?.method).toBe('POST')
      const bodyText = typeof init?.body === 'string' ? init.body : ''
      const body = JSON.parse(bodyText) as Record<string, unknown>
      expect(body.device_key).toBe('secret-device-key')
      return new Response(JSON.stringify({ code: 200, message: 'success' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    expect(await adapter.send(barkChannel(), message, { timeoutMs: 1000, fetch: fetchOk })).toEqual({
      ok: true,
      statusCode: 200,
    })

    const fetchPlainOk = vi.fn<PushFetch>(async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }))
    expect(await adapter.send(barkChannel(), message, { timeoutMs: 1000, fetch: fetchPlainOk })).toEqual({
      ok: true,
      statusCode: 200,
    })

    const fetchInvalidJsonOk = vi.fn<PushFetch>(async () => new Response('{broken', { status: 200, headers: { 'content-type': 'application/json' } }))
    expect(await adapter.send(barkChannel(), message, { timeoutMs: 1000, fetch: fetchInvalidJsonOk })).toEqual({
      ok: true,
      statusCode: 200,
    })

    const fetchBarkError = vi.fn<PushFetch>(async () => new Response(JSON.stringify({ code: 400, message: 'invalid key' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    expect(await adapter.send(barkChannel(), message, { timeoutMs: 1000, fetch: fetchBarkError })).toEqual({
      ok: false,
      reason: 'http-error',
      statusCode: 400,
    })

    const fetchHttpError = vi.fn<PushFetch>(async () => new Response('bad gateway', { status: 502 }))
    expect(await adapter.send(barkChannel(), message, { timeoutMs: 1000, fetch: fetchHttpError })).toEqual({
      ok: false,
      reason: 'http-error',
      statusCode: 502,
    })

    const fetchNetworkError = vi.fn<PushFetch>(async () => { throw new Error('ECONNREFUSED') })
    expect(await adapter.send(barkChannel(), message, { timeoutMs: 1000, fetch: fetchNetworkError })).toEqual({
      ok: false,
      reason: 'request-failed',
    })

    const fetchTimeout = vi.fn<PushFetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('timeout aborted')) }, { once: true })
    }))
    expect(await adapter.send(barkChannel(), message, { timeoutMs: 15, fetch: fetchTimeout })).toEqual({
      ok: false,
      reason: 'timed-out',
    })

    const callerAbort = new AbortController()
    const fetchCancelled = vi.fn<PushFetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('caller aborted')) }, { once: true })
      queueMicrotask(() => { callerAbort.abort() })
    }))
    expect(await adapter.send(barkChannel(), message, {
      timeoutMs: 5000,
      signal: callerAbort.signal,
      fetch: fetchCancelled,
    })).toEqual({
      ok: false,
      reason: 'cancelled',
    })
  })

  it('registers, lists, rejects duplicates, and disposes push provider adapters', () => {
    const registry = new PushProviderRegistry()
    const bark = new BarkPushAdapter()
    const dispose = registry.register(bark)
    expect(registry.get('bark')).toBe(bark)
    expect(registry.list()).toEqual(['bark'])
    expect(() => registry.register(bark)).toThrow(/already registered/)
    expect(() => registry.register({
      provider: '   ',
      validate: () => undefined,
      send: async () => ({ ok: true }),
    })).toThrow(/non-empty/)
    dispose()
    expect(registry.get('bark')).toBeUndefined()
  })
})
