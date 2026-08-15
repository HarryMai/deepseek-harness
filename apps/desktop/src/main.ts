/** Electron main process for the DeepSeek Harness desktop application. */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, session, shell, type Event as ElectronEvent } from 'electron'
import desktopBuildConfig from '../desktop-build.config.json' with { type: 'json' }
import {
  ACL_RUNNER_DEBUG_LOG_ENV,
  desktopArguments,
  isApplicationNavigation,
  isExternalWebUrl,
  packagedHostEntry,
  packagedNodeExecutable,
  resolveNodeExecutable,
} from './runtime.ts'
import {
  manageHostProcess,
  stopHostProcess,
  waitForHostReady,
  type ManagedHostProcess,
} from './process-lifecycle.ts'
import { squirrelLifecycleAction } from './squirrel.ts'

const HOST_START_TIMEOUT_MS = 60_000
const HOST_SHUTDOWN_TIMEOUT_MS = 6_000
const hostEntry = app.isPackaged
  ? packagedHostEntry(process.resourcesPath)
  : fileURLToPath(new URL('./host.js', import.meta.url))

let hostProcess: ManagedHostProcess | undefined
let hostReady = false
let applicationUrl: string | undefined
let mainWindow: BrowserWindow | undefined
let shutdownStarted = false

function handleSquirrelLifecycle(): boolean {
  const action = squirrelLifecycleAction(process.argv, process.execPath, process.platform, {
    desktop: desktopBuildConfig.windows.installer.createDesktopShortcut,
    startMenu: desktopBuildConfig.windows.installer.createStartMenuShortcut,
  })
  if (action === undefined) return false
  if (action.kind === 'quit') {
    app.quit()
    return true
  }

  const update = spawn(action.executable, action.args, {
    stdio: 'ignore',
    windowsHide: true,
  })
  let finished = false
  const quit = (): void => {
    if (finished) return
    finished = true
    app.quit()
  }
  update.once('error', quit)
  update.once('close', quit)
  return true
}

function openExternal(url: string): void {
  if (!isExternalWebUrl(url)) return
  void shell.openExternal(url).catch((error: unknown) => {
    console.error('desktop: failed to open external URL', error)
  })
}

async function startHost(args: readonly string[]): Promise<string> {
  const child = spawn(
    app.isPackaged
      ? packagedNodeExecutable(process.resourcesPath, process.platform)
      : resolveNodeExecutable(process.env),
    [hostEntry, ...args],
    {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        // The windows-acl runner appends per-spawn forensics here (the
        // sandbox seam forwards it as --debug-log), so a field recurrence of
        // the 0xC0000142 init failure is self-describing instead of a bare
        // popup. Best-effort: the runner ignores an unwritable path.
        [ACL_RUNNER_DEBUG_LOG_ENV]: join(app.getPath('userData'), 'logs', 'acl-runner.log'),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    },
  )
  const managed = manageHostProcess(child)
  hostProcess = managed
  child.stdout?.pipe(process.stdout)
  child.stderr?.pipe(process.stderr)

  child.once('exit', (code, signal) => {
    if (!hostReady || shutdownStarted) return
    dialog.showErrorBox(
      'DeepSeek Harness stopped',
      `The local Host exited unexpectedly (code ${String(code)}, signal ${String(signal)}).`,
    )
    app.quit()
  })
  child.once('close', () => {
    if (hostProcess === managed) hostProcess = undefined
  })

  const url = await waitForHostReady(child, HOST_START_TIMEOUT_MS)
  managed.refreshProcessTree()
  return url
}

function stopHost(): Promise<void> {
  const host = hostProcess
  return host === undefined
    ? Promise.resolve()
    : stopHostProcess(host, { gracefulTimeoutMs: HOST_SHUTDOWN_TIMEOUT_MS })
}

async function createWindow(url: string): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    backgroundColor: '#111315',
    title: 'DeepSeek Harness',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  })
  mainWindow = window
  window.once('ready-to-show', () => { window.show() })
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target)
    return { action: 'deny' }
  })
  const guardNavigation = (event: ElectronEvent, target: string): void => {
    if (isApplicationNavigation(url, target)) return
    event.preventDefault()
    openExternal(target)
  }
  window.webContents.on('will-navigate', guardNavigation)
  window.webContents.on('will-redirect', guardNavigation)
  window.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
  await window.loadURL(url)
}

async function startApplication(): Promise<void> {
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  applicationUrl = await startHost(desktopArguments(process.argv, process.defaultApp))
  hostReady = true
  await createWindow(applicationUrl)
}

const squirrelLifecycle = handleSquirrelLifecycle()
const singleInstance = squirrelLifecycle ? false : app.requestSingleInstanceLock()
if (squirrelLifecycle || !singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length !== 0 || applicationUrl === undefined) return
    void createWindow(applicationUrl).catch((error: unknown) => {
      dialog.showErrorBox('DeepSeek Harness failed to open', error instanceof Error ? error.message : String(error))
    })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (shutdownStarted || hostProcess === undefined) return
    event.preventDefault()
    shutdownStarted = true
    void stopHost().then(
      () => { app.quit() },
      (error: unknown) => {
        shutdownStarted = false
        dialog.showErrorBox(
          'DeepSeek Harness could not stop',
          error instanceof Error ? error.message : String(error),
        )
      },
    )
  })
  void app.whenReady().then(startApplication).catch((error: unknown) => {
    dialog.showErrorBox(
      'DeepSeek Harness failed to start',
      error instanceof Error ? error.message : String(error),
    )
    app.quit()
  })
}
