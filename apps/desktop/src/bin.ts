#!/usr/bin/env node
/** Node launcher that starts the Electron desktop application. */

/* v8 ignore file -- published-entry smoke owns this process adapter. */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DESKTOP_NODE_EXECUTABLE } from './runtime.ts'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const mainEntry = fileURLToPath(new URL('../lib/main.js', import.meta.url))
if (!existsSync(mainEntry)) {
  throw new Error('dsh-desktop: built application is missing; run `pnpm run build` first')
}

const require = createRequire(import.meta.url)
const electronPath: unknown = require('electron')
if (typeof electronPath !== 'string' || electronPath === '') {
  throw new Error('dsh-desktop: electron did not resolve to an executable')
}

const args = process.argv.slice(2)
if (args.length === 1 && (args[0] === '--version' || args[0] === '-V')) {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('dsh-desktop: package version is missing')
  console.log(manifest.version)
} else {
  const child = spawn(electronPath, [appRoot, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      [DESKTOP_NODE_EXECUTABLE]: process.execPath,
    },
    stdio: 'inherit',
    windowsHide: false,
  })

  child.once('error', (error) => {
    console.error(error)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    if (signal !== null) {
      console.error(`dsh-desktop: Electron exited from signal ${signal}`)
      process.exitCode = 1
      return
    }
    process.exitCode = code ?? 1
  })
}
