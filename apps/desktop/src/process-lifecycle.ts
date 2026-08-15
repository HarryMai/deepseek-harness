/**
 * Bounded startup and process-tree shutdown for the desktop Host child.
 * @module @deepseek-ai/dsh-desktop/process-lifecycle
 */

import { spawnSync, type ChildProcess } from 'node:child_process'
import {
  createProcessInspector,
  type ProcessIdentity,
  type ProcessInspector,
} from '@deepseek-ai/dsh-subprocess-local/process-inspector'
import { parseDesktopHostMessage, type DesktopHostShutdown } from './runtime.ts'

/** Maximum wait after forced termination before the shell reports an operating-system failure. */
const FORCE_EXIT_TIMEOUT_MS = 6_000

function isMissingProcess(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'ESRCH'
}

/**
 * Terminate a POSIX Host before signalling previously captured descendant identities.
 * @param inspector - Supported platform process-table implementation.
 * @param host - Exact Host identity captured while the child was alive.
 * @param descendants - Exact descendant identities captured while the Host identity matched.
 * @returns Nothing after every retained identity is checked for forced termination.
 */
export function forcePosixProcessTree(
  inspector: ProcessInspector,
  host: ProcessIdentity,
  descendants: readonly ProcessIdentity[],
): void {
  const errors: unknown[] = []
  const force = (identity: ProcessIdentity): void => {
    try {
      inspector.signalProcess(identity, 'SIGKILL')
    } catch (error) {
      if (!isMissingProcess(error)) errors.push(error)
    }
  }
  force(host)
  for (const identity of descendants) force(identity)
  if (errors.length > 0) {
    throw new AggregateError(errors, 'desktop: could not terminate the complete local Host process tree')
  }
}

/**
 * Wait for one Host child to publish its validated application URL.
 * @param child - Spawned ordinary-Node Host process.
 * @param timeoutMs - Maximum startup duration.
 * @returns The loopback application URL sent through IPC.
 */
export function waitForHostReady(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (outcome: { url: string } | { error: Error }): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off('message', onMessage)
      child.off('error', onError)
      child.off('exit', onEarlyExit)
      if ('url' in outcome) resolve(outcome.url)
      else reject(outcome.error)
    }
    const onMessage = (value: unknown): void => {
      const message = parseDesktopHostMessage(value)
      if (message?.type === 'ready') finish({ url: message.url })
      if (message?.type === 'error') finish({ error: new Error(message.message) })
    }
    const onError = (error: Error): void => { finish({ error }) }
    const onEarlyExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish({
        error: new Error(
          `desktop: local Host exited before startup (code ${String(code)}, signal ${String(signal)})`,
        ),
      })
    }
    const timeout = setTimeout(() => {
      finish({ error: new Error(`desktop: local Host did not become ready within ${String(timeoutMs)}ms`) })
    }, timeoutMs)
    child.on('message', onMessage)
    child.once('error', onError)
    child.once('exit', onEarlyExit)
  })
}

/**
 * A spawned Host together with exact process identities retained until `close`.
 */
export interface ManagedHostProcess {
  /** Spawned ordinary-Node Host child. */
  readonly child: ChildProcess
  /** Capture current descendants only while the original Host identity still matches. */
  refreshProcessTree(): void
  /** Force-terminate every still-live retained Host-tree identity. */
  forceProcessTree(): void
}

function forceWindowsProcessTree(child: ChildProcess): void {
  const { pid } = child
  if (pid === undefined) throw new Error('desktop: local Host has no process id')
  const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0 && child.exitCode === null && child.signalCode === null) {
    const detail = result.stderr.trim() || result.stdout.trim() || `status ${String(result.status)}`
    throw new Error(`desktop: could not terminate local Host process tree: ${detail}`)
  }
}

function identityKey(identity: ProcessIdentity): string {
  return `${String(identity.pid)}\0${identity.started}`
}

/**
 * Retain exact Host-tree identities from spawn through final process closure.
 * @param child - Spawned ordinary-Node Host child.
 * @param platform - Host operating system.
 * @param injectedInspector - Optional process-table implementation for tests.
 * @returns Managed Host process used by desktop shutdown.
 */
export function manageHostProcess(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform,
  injectedInspector?: ProcessInspector,
): ManagedHostProcess {
  if (platform === 'win32') {
    return {
      child,
      refreshProcessTree: () => {},
      forceProcessTree: () => { forceWindowsProcessTree(child) },
    }
  }

  const inspector = injectedInspector ?? createProcessInspector(platform)
  let host: ProcessIdentity | undefined
  let descendants: ProcessIdentity[] = []
  const refreshProcessTree = (): void => {
    const { pid } = child
    if (pid === undefined) return
    const current = inspector.processTree(pid)
    const currentHost = current.find(identity => identity.pid === pid)
    if (host === undefined) {
      if (currentHost === undefined) return
      host = currentHost
    } else if (currentHost?.started !== host.started) {
      return
    }
    const currentDescendants = current.filter(identity => identity.pid !== pid)
    const currentKeys = new Set(currentDescendants.map(identityKey))
    descendants = [
      ...currentDescendants,
      ...descendants.filter(identity => !currentKeys.has(identityKey(identity))),
    ]
  }
  refreshProcessTree()
  return {
    child,
    refreshProcessTree,
    forceProcessTree: () => {
      refreshProcessTree()
      if (host === undefined) {
        throw new Error('desktop: local Host identity was unavailable before forced termination')
      }
      forcePosixProcessTree(inspector, host, descendants)
    },
  }
}

/** Options for bounded Host shutdown, replaceable by tests. */
export interface StopHostOptions {
  /** Grace after the IPC shutdown request. */
  readonly gracefulTimeoutMs: number
  /** Grace after forced process-tree termination. */
  readonly forceTimeoutMs?: number
}

/**
 * Request graceful Host disposal, escalate to process-tree termination, and wait for closure.
 * @param host - Managed ordinary-Node Host process.
 * @param options - Grace periods and force implementation.
 * @returns A promise that settles only after process closure or a termination failure.
 */
export function stopHostProcess(host: ManagedHostProcess, options: StopHostOptions): Promise<void> {
  const { child } = host
  try {
    host.refreshProcessTree()
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
  const forceTimeoutMs = options.forceTimeoutMs ?? FORCE_EXIT_TIMEOUT_MS
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let forced = false
    let timeout: ReturnType<typeof setTimeout>
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off('close', onClose)
      if (error === undefined) resolve()
      else reject(error)
    }
    const onClose = (): void => { finish() }
    const forceAndWait = (): void => {
      if (settled || forced) return
      forced = true
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        finish(new Error(`desktop: local Host remained alive after forced termination for ${String(forceTimeoutMs)}ms`))
      }, forceTimeoutMs)
      try {
        host.forceProcessTree()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    child.once('close', onClose)
    timeout = setTimeout(forceAndWait, options.gracefulTimeoutMs)
    if (!child.connected) {
      forceAndWait()
      return
    }
    child.send({ type: 'shutdown' } satisfies DesktopHostShutdown, (error) => {
      if (error !== null) forceAndWait()
    })
  })
}
