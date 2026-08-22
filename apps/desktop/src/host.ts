#!/usr/bin/env node
/** Ordinary-Node child that owns the existing Web profile for Electron. */

/* v8 ignore file -- the desktop smoke launches this process through its built entry. */

import { runWebProfile } from '@deepseek-ai/dsh/desktop-host'
import {
  isDesktopHostShutdown,
  resolveDesktopWebServer,
  webServerUrl,
  type DesktopHostMessage,
} from './runtime.ts'

function send(message: DesktopHostMessage): void {
  if (process.connected) process.send?.(message)
}

const shutdownRequest = { received: false }
let stop: (() => void) | undefined

process.on('message', (message: unknown) => {
  if (!isDesktopHostShutdown(message)) return
  shutdownRequest.received = true
  stop?.()
})

process.once('disconnect', () => {
  shutdownRequest.received = true
  stop?.()
})

try {
  const { ctx, shutdown } = await runWebProfile(process.argv.slice(2))
  let stopping = false
  stop = () => {
    if (stopping) return
    stopping = true
    void shutdown.shutdown(0).finally(() => {
      if (process.connected) process.disconnect()
    })
  }
  if (shutdownRequest.received) {
    stop()
  } else {
    const server = resolveDesktopWebServer(ctx.loader.entries())
    send({ type: 'ready', url: webServerUrl(server.host, server.port) })
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  send({ type: 'error', message })
  console.error(error)
  if (process.connected) process.disconnect()
  process.exitCode = 1
}
