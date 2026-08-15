import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type { DesktopHostMessage } from '../src/runtime.ts'

const hostEntry = fileURLToPath(new URL('../lib/host.js', import.meta.url))

function waitForMessage(child: ChildProcess): Promise<DesktopHostMessage> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      reject(new Error(
        `desktop snapshot: Host exited before readiness (code ${String(code)}, signal ${String(signal)})`,
      ))
    })
    child.once('message', (message: unknown) => {
      resolve(message as DesktopHostMessage)
    })
  })
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => { resolve(code) })
  })
}

it('boots and disposes the built Web profile through the desktop Host boundary', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-snapshot-'))
  const child = spawn(process.execPath, [hostEntry], {
    cwd: process.cwd(),
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => { stderr += chunk })

  try {
    const message = await waitForMessage(child)
    if (message.type === 'error') throw new Error(message.message)
    const response = await fetch(message.url)
    const html = await response.text()
    const exit = waitForExit(child)
    child.send({ type: 'shutdown' })

    expect({
      readyProtocol: new URL(message.url).protocol,
      readyHost: new URL(message.url).hostname,
      hasAssignedPort: new URL(message.url).port !== '',
      responseStatus: response.status,
      contentType: response.headers.get('content-type'),
      hasBootManifest: html.includes('__DSH_BOOT__'),
      exitCode: await exit,
      stderr: stderr.trim(),
    }).toMatchInlineSnapshot(`
      {
        "contentType": "text/html; charset=utf-8",
        "exitCode": 0,
        "hasAssignedPort": true,
        "hasBootManifest": true,
        "readyHost": "127.0.0.1",
        "readyProtocol": "http:",
        "responseStatus": 200,
        "stderr": "",
      }
    `)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await rm(home, { recursive: true, force: true })
  }
})
