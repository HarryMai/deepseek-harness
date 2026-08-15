/**
 * Error-mode suppression + forensic debug-log regression (field follow-up
 * 2026-08-15): even with the confinement desktop pin, the field saw residual
 * intermittent STATUS_DLL_INIT_FAILED (0xC0000142) popups from confined
 * grandchildren. The runner now installs the popup-suppressing process error
 * mode (SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX |
 * SEM_NOOPENFILEERRORBOX), which CreateProcess propagates to the whole
 * confined tree, so a loader-init death reports its NTSTATUS exit code
 * through the tool result instead of raising a modal Application Popup. The
 * `--debug-log` channel records the console/desktop/spawn/exit decisions a
 * recurrence report needs. This spec proves the bits reach a confined
 * grandchild and that the log carries the full decision trail.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DEBUG_LOG_MAX_BYTES, DebugLog } from '../src/debug-log.ts'

const isWin32 = process.platform === 'win32'
const runnerEntry = fileURLToPath(new URL('../src/runner.ts', import.meta.url))
const errorModeFixture = fileURLToPath(new URL('./fixtures/report-error-mode.mjs', import.meta.url))

/** SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX. */
const SUPPRESSION_MASK = 0x8003

interface DebugEvent {
  readonly event: string
  readonly [key: string]: unknown
}

function readEvents(logPath: string): DebugEvent[] {
  return readFileSync(logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line) as DebugEvent)
}

describe('DebugLog', () => {
  it('is a no-op without a path and rotates an oversized log once', () => {
    const silent = new DebugLog(undefined)
    expect(silent.enabled).toBe(false)
    silent.record('nothing') // must not throw

    const root = mkdtempSync(join(tmpdir(), 'dsh-acl-debuglog-'))
    try {
      const logDir = join(root, 'nested')
      mkdirSync(logDir)
      const logPath = join(logDir, 'debug.log')
      writeFileSync(logPath, 'x'.repeat(DEBUG_LOG_MAX_BYTES + 16))
      const log = new DebugLog(logPath)
      expect(log.enabled).toBe(true)
      log.record('fresh', { ok: true })
      expect(existsSync(`${logPath}.1`)).toBe(true)
      const events = readEvents(logPath)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ event: 'fresh', ok: true, pid: process.pid })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!isWin32)('windows-acl runner error mode + debug log', () => {
  let scratchRoot!: string
  let writableDir!: string
  let isolatedTemp!: string

  beforeAll(() => {
    scratchRoot = mkdtempSync(join(tmpdir(), 'dsh-acl-errmode-'))
    writableDir = join(scratchRoot, 'writable')
    mkdirSync(writableDir)
    isolatedTemp = mkdtempSync(join(tmpdir(), 'dsh-acl-errmode-temp-'))
  })

  afterAll(() => {
    rmSync(scratchRoot, { recursive: true, force: true })
    rmSync(isolatedTemp, { recursive: true, force: true })
  })

  it('a confined grandchild inherits the popup-suppressing error mode', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', runnerEntry,
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write',
        '--', process.execPath, errorModeFixture],
      { encoding: 'utf8', windowsHide: true, timeout: 60_000 },
    )
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    // Node may add its own bits at startup, but the runner's three
    // suppression bits must survive the runner → grandchild inheritance.
    const confined = Number(result.stdout.trim().replace('ERROR-MODE:', ''))
    expect(confined & SUPPRESSION_MASK).toBe(SUPPRESSION_MASK)
  }, 60_000)

  it('--debug-log records the gate, spawn, and exit decisions in order', () => {
    const logPath = join(scratchRoot, 'debug.log')
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', runnerEntry,
        '--workspace', writableDir, '--temp', isolatedTemp, '--mode', 'workspace-write',
        '--debug-log', logPath,
        '--', process.execPath, errorModeFixture],
      { encoding: 'utf8', windowsHide: true, timeout: 60_000 },
    )
    expect(result.status, `stderr: ${result.stderr}`).toBe(0)
    expect(existsSync(logPath)).toBe(true)
    const events = readEvents(logPath)
    const byName = (name: string): DebugEvent[] => events.filter(entry => entry.event === name)

    const start = byName('start')
    expect(start).toHaveLength(1)
    expect(start[0]!).toMatchObject({ mode: 'workspace-write', seamManaged: false })
    expect(typeof start[0]!.previousErrorMode).toBe('number')

    const init = byName('init')
    expect(init).toHaveLength(1)
    expect(init[0]!).toMatchObject({ mode: 'workspace-write' })
    expect(typeof init[0]!.console).toBe('boolean')

    const spawn = byName('spawn')
    expect(spawn).toHaveLength(1)
    expect(spawn[0]!.command).toBe(process.execPath)

    // windowsHide makes this runner console-less, so the confinement desktop
    // must be created and pinned; a console-present test host records no
    // desktop event and a null pin instead.
    if (init[0]!.console === false) {
      const desktop = byName('desktop')
      expect(desktop).toHaveLength(1)
      expect(String(desktop[0]!.lpDesktop)).toMatch(/^WinSta\d+\\dsh-acl-\d+-[0-9a-f]{6}$/u)
      expect(String(spawn[0]!.desktop)).toBe(String(desktop[0]!.lpDesktop))
      expect(events.map(entry => entry.event)).toEqual(['start', 'init', 'desktop', 'spawn', 'exit'])
    } else {
      expect(byName('desktop')).toHaveLength(0)
      expect(spawn[0]!.desktop).toBeNull()
      expect(events.map(entry => entry.event)).toEqual(['start', 'init', 'spawn', 'exit'])
    }

    expect(byName('exit')).toEqual([expect.objectContaining({ exitCode: 0 })])
    expect(byName('spawn-fail')).toHaveLength(0)
  }, 60_000)
})
