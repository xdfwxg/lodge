import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

const APP_NAME = 'Lodge'
const DEFAULT_PORT = 8787
const BASE_URL = process.env.CREW_BASE_URL ?? 'http://127.0.0.1:8799'
const appRoot = app.isPackaged ? join(process.resourcesPath, 'app') : app.getAppPath()
const dataDir = join(app.getPath('userData'), 'data')
const logDir = join(app.getPath('userData'), 'logs')
const logFile = join(logDir, 'server.log')

let window = null
let serverProcess = null
let serverPort = null
let quitting = false

const log = text => {
  try {
    mkdirSync(logDir, { recursive: true })
    appendFileSync(logFile, `[${new Date().toISOString()}] ${text}\n`)
  } catch {}
}

const findPort = start => new Promise(resolve => {
  const probe = createServer()
  probe.once('error', () => resolve(findPort(start + 1)))
  probe.listen(start, '127.0.0.1', () => {
    const port = probe.address()?.port ?? start
    probe.close(() => resolve(port))
  })
})

const waitForHealth = async (port, attempts = 80) => {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return true
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return false
}

const startServer = async () => {
  serverPort = await findPort(DEFAULT_PORT)
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    CREW_PORT: String(serverPort),
    CREW_DATA_DIR: dataDir,
    CREW_BASE_URL: BASE_URL,
  }
  serverProcess = spawn(process.execPath, [join(appRoot, 'server', 'index.js')], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProcess.stdout.on('data', chunk => log(`out: ${chunk.toString().trimEnd()}`))
  serverProcess.stderr.on('data', chunk => log(`err: ${chunk.toString().trimEnd()}`))
  serverProcess.on('exit', code => {
    log(`server exited: ${code}`)
    if (!quitting) {
      dialog.showErrorBox(APP_NAME, `Lodge 服务已退出（code ${code}）。日志：${logFile}`)
    }
  })
  const healthy = await waitForHealth(serverPort)
  if (!healthy) {
    throw new Error(`Lodge 服务没有在端口 ${serverPort} 起来。日志：${logFile}`)
  }
  return serverPort
}

const stopServer = () => {
  if (serverProcess === null || serverProcess.killed) return
  try {
    serverProcess.kill('SIGTERM')
    setTimeout(() => {
      if (!serverProcess.killed) serverProcess.kill('SIGKILL')
    }, 2_000).unref()
  } catch (error) {
    log(`stop failed: ${error?.message ?? error}`)
  }
  serverProcess = null
}

const buildMenu = () => {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const createWindow = port => {
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'Lodge',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f7f7f5',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const origin = `http://127.0.0.1:${port}`
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  window.once('ready-to-show', () => window?.show())
  void window.loadURL(origin)
  window.on('closed', () => { window = null })
}

const boot = async () => {
  app.setName(APP_NAME)
  buildMenu()
  try {
    const port = await startServer()
    createWindow(port)
  } catch (error) {
    log(`boot failed: ${error?.message ?? error}`)
    dialog.showErrorBox(APP_NAME, `启动失败：${error?.message ?? error}\n日志：${logFile}`)
    app.quit()
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window === null) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.whenReady().then(boot)
  app.on('activate', () => {
    if (window === null && serverPort !== null) createWindow(serverPort)
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    quitting = true
    stopServer()
  })
}
