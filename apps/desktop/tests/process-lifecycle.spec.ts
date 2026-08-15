import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import type { ProcessIdentity, ProcessInspector } from '@deepseek-ai/dsh-subprocess-local/process-inspector'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  forcePosixProcessTree,
  manageHostProcess,
  stopHostProcess,
  waitForHostReady,
  type ManagedHostProcess,
} from '../src/process-lifecycle.ts'

class FakeHostProcess extends EventEmitter {
  readonly pid = 43123
  readonly sent: unknown[] = []
  connected = true
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  sendError: Error | null = null

  send(message: unknown, callback: (error: Error | null) => void): boolean {
    this.sent.push(message)
    callback(this.sendError)
    return this.sendError === null
  }
}

function asChild(process: FakeHostProcess): ChildProcess {
  return process as unknown as ChildProcess
}

function managedHost(
  process: FakeHostProcess,
  forceProcessTree = vi.fn(),
  refreshProcessTree = vi.fn(),
): ManagedHostProcess {
  return { child: asChild(process), forceProcessTree, refreshProcessTree }
}

afterEach(() => { vi.useRealTimers() })

describe('desktop Host startup', () => {
  it('accepts a validated ready message', async () => {
    const child = new FakeHostProcess()
    const ready = waitForHostReady(asChild(child), 1_000)
    child.emit('message', { type: 'ready', url: 'http://127.0.0.1:43123/' })
    await expect(ready).resolves.toBe('http://127.0.0.1:43123/')
  })

  it('reports spawn errors and early exits', async () => {
    const spawnErrorChild = new FakeHostProcess()
    const spawnError = waitForHostReady(asChild(spawnErrorChild), 1_000)
    spawnErrorChild.emit('error', new Error('spawn failed'))
    await expect(spawnError).rejects.toThrow('spawn failed')

    const exitChild = new FakeHostProcess()
    const earlyExit = waitForHostReady(asChild(exitChild), 1_000)
    exitChild.emit('exit', 3, null)
    await expect(earlyExit).rejects.toThrow('exited before startup (code 3, signal null)')
  })

  it('bounds a Host that never becomes ready', async () => {
    vi.useFakeTimers()
    const ready = waitForHostReady(asChild(new FakeHostProcess()), 25)
    const rejection = expect(ready).rejects.toThrow('did not become ready within 25ms')
    await vi.advanceTimersByTimeAsync(25)
    await rejection
  })
})

describe('desktop Host shutdown', () => {
  it('forces the Host before every captured POSIX descendant identity', () => {
    const host = { pid: 43123, started: 'host' }
    const child = { pid: 43124, started: 'child' }
    const grandchild = { pid: 43125, started: 'grandchild' }
    const signals: ProcessIdentity[] = []
    const inspector = {
      processTree: () => [grandchild, child, host],
      signalProcess: (identity: ProcessIdentity) => { signals.push(identity) },
    } as unknown as ProcessInspector

    forcePosixProcessTree(inspector, host, [grandchild, child])

    expect(signals).toEqual([host, grandchild, child])
  })

  it('retains descendants after Host exit without following a reused Host pid', () => {
    const host = { pid: 43123, started: 'host' }
    const child = { pid: 43124, started: 'child' }
    const replacement = { pid: 43123, started: 'replacement' }
    const snapshots = [[host], [child, host], [replacement]]
    const signals: ProcessIdentity[] = []
    const inspector = {
      processTree: () => snapshots.shift() ?? [replacement],
      signalProcess: (identity: ProcessIdentity) => { signals.push(identity) },
    } as unknown as ProcessInspector
    const managed = manageHostProcess(asChild(new FakeHostProcess()), 'linux', inspector)

    managed.refreshProcessTree()
    managed.forceProcessTree()

    expect(signals).toEqual([host, child])
  })

  it('requests graceful shutdown and waits for process closure', async () => {
    const child = new FakeHostProcess()
    const stopped = stopHostProcess(managedHost(child), { gracefulTimeoutMs: 1_000 })
    expect(child.sent).toEqual([{ type: 'shutdown' }])
    child.emit('close', 0, null)
    await expect(stopped).resolves.toBeUndefined()
  })

  it('forces the process tree after the grace and still waits for closure', async () => {
    vi.useFakeTimers()
    const child = new FakeHostProcess()
    const force = vi.fn()
    let settled = false
    const stopped = stopHostProcess(managedHost(child, force), {
      gracefulTimeoutMs: 25,
      forceTimeoutMs: 50,
    }).then(() => { settled = true })

    await vi.advanceTimersByTimeAsync(25)
    expect(force).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    child.emit('close', null, 'SIGKILL')
    await stopped
    expect(settled).toBe(true)
  })

  it('forces and waits for close when exit has already occurred', async () => {
    const child = new FakeHostProcess()
    child.connected = false
    child.exitCode = 0
    const force = vi.fn()
    let settled = false
    const stopped = stopHostProcess(managedHost(child, force), {
      gracefulTimeoutMs: 1_000,
      forceTimeoutMs: 50,
    }).then(() => { settled = true })

    expect(force).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    child.emit('close', 0, null)
    await stopped
    expect(settled).toBe(true)
  })

  it('forces immediately after an IPC failure', async () => {
    const child = new FakeHostProcess()
    child.sendError = new Error('channel closed')
    const force = vi.fn()
    const stopped = stopHostProcess(managedHost(child, force), { gracefulTimeoutMs: 1_000 })
    expect(force).toHaveBeenCalledOnce()
    child.emit('close', null, 'SIGKILL')
    await expect(stopped).resolves.toBeUndefined()
  })

  it('rejects when forced termination does not close the process', async () => {
    vi.useFakeTimers()
    const child = new FakeHostProcess()
    const stopped = stopHostProcess(managedHost(child), {
      gracefulTimeoutMs: 25,
      forceTimeoutMs: 50,
    })
    const rejection = expect(stopped).rejects.toThrow('remained alive after forced termination for 50ms')
    await vi.advanceTimersByTimeAsync(75)
    await rejection
  })
})
