import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron'
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'

const APP_NAME = 'Lodge'
const DEFAULT_PORT = 8787
const DEFAULT_BASE_PORT = 8799
const appRoot = app.isPackaged ? join(process.resourcesPath, 'app') : app.getAppPath()
const iconFile = join(app.getAppPath(), 'build', 'icon.png')
const dataDir = join(app.getPath('userData'), 'data')
const logDir = join(app.getPath('userData'), 'logs')
const logFile = join(logDir, 'server.log')
const settingsFile = join(app.getPath('userData'), 'settings.json')

let window = null
let serverProcess = null
let serverPort = null
let baseProcess = null
let baseDir = null
let baseUrl = process.env.CREW_BASE_URL ?? ''
let quitting = false
let serverRestarts = 0

const readSettings = () => {
  try {
    return JSON.parse(readFileSync(settingsFile, 'utf8'))
  } catch {
    return {}
  }
}

const writeSettings = next => {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), ...next }, null, 2))
  } catch (error) {
    log(`settings write failed: ${error?.message ?? error}`)
  }
}

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

const isBaseUp = async url => {
  if (typeof url !== 'string' || url === '') return false
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/api/instances`, { signal: AbortSignal.timeout(1_500) })
    if (!response.ok) return false
    const data = await response.json()
    return Array.isArray(data?.instances)
  } catch {
    return false
  }
}

const findNode = () => {
  if (typeof process.env.LODGE_NODE === 'string' && existsSync(process.env.LODGE_NODE)) return process.env.LODGE_NODE
  const candidates = [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    join(homedir(), '.local/bin/node'),
    join(homedir(), '.nvm/current/bin/node'),
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  try {
    return execFileSync('which', ['node'], { encoding: 'utf8', timeout: 2_000 }).trim()
  } catch {
    return null
  }
}

const findBaseDir = () => {
  if (typeof process.env.LODGE_BASE_DIR === 'string' && existsSync(process.env.LODGE_BASE_DIR)) return process.env.LODGE_BASE_DIR
  const settings = readSettings()
  if (typeof settings.baseDir === 'string' && existsSync(settings.baseDir)) return settings.baseDir
  const candidates = [
    join(app.getAppPath(), '..', 'crew-chat-base'),
    join(process.resourcesPath, 'base'),
    join(homedir(), 'workspace', 'crew-chat-base'),
  ]
  for (const candidate of candidates) if (existsSync(join(candidate, 'server', 'openmausbot.ts'))) return candidate
  return null
}

const chooseBaseDir = async () => {
  const choice = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['选择基座目录', '退出'],
    defaultId: 0,
    cancelId: 1,
    title: 'Lodge 需要本地基座',
    message: 'Lodge 需要 crew-chat-base 才能运行真实 CLI 回合。',
    detail: '选择已经安装好的 crew-chat-base 目录。它负责 driver、CLI 和本地运行时；Lodge 不会修改它。',
  })
  if (choice.response !== 0) return null
  const picked = await dialog.showOpenDialog({
    title: '选择 crew-chat-base 目录',
    properties: ['openDirectory', 'createDirectory'],
  })
  const dir = picked.filePaths?.[0] ?? null
  if (dir !== null) writeSettings({ baseDir: dir })
  return dir
}

const startBase = async dir => {
  baseDir = dir
  const node = findNode()
  if (node === null) {
    await dialog.showMessageBox({
      type: 'error',
      buttons: ['退出'],
      message: '没有找到 Node.js',
      detail: 'Lodge 的基座需要 Node.js 22.5 或更高版本。安装后重启 Lodge。',
    })
    return null
  }
  const port = await findPort(DEFAULT_BASE_PORT)
  const baseData = join(app.getPath('userData'), 'base-data')
  mkdirSync(baseData, { recursive: true })
  const child = spawn(node, [
    '--experimental-strip-types',
    'server/openmausbot.ts',
    'serve',
    '--port', String(port),
    '--data-dir', baseData,
  ], {
    cwd: dir,
    env: { ...process.env, LODGE_BASE_DIR: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => log(`base out: ${chunk.toString().trimEnd()}`))
  child.stderr.on('data', chunk => log(`base err: ${chunk.toString().trimEnd()}`))
  child.on('exit', code => {
    log(`base exited: ${code}`)
    if (!quitting) log('base stopped unexpectedly')
  })
  baseProcess = child
  baseUrl = `http://127.0.0.1:${port}`
  const healthy = await isBaseUp(baseUrl)
  if (!healthy) {
    try { child.kill('SIGTERM') } catch {}
    baseProcess = null
    throw new Error(`基座没有在端口 ${port} 起来。日志：${logFile}`)
  }
  return baseUrl
}

const ensureBase = async () => {
  if (baseUrl !== '' && await isBaseUp(baseUrl)) return baseUrl
  if (await isBaseUp(`http://127.0.0.1:${DEFAULT_BASE_PORT}`)) {
    baseUrl = `http://127.0.0.1:${DEFAULT_BASE_PORT}`
    return baseUrl
  }
  let dir = findBaseDir()
  if (dir === null) dir = await chooseBaseDir()
  if (dir === null) return null
  return startBase(dir)
}

const checkCli = async url => {
  try {
    const response = await fetch(`${url}/api/instances`, { signal: AbortSignal.timeout(2_000) })
    const data = await response.json()
    const available = (data?.instances ?? []).filter(item => item?.snapshot?.state === 'available')
    if (available.length > 0) return true
    const installs = (data?.instances ?? [])
      .filter(item => item?.install?.command?.darwin)
      .slice(0, 3)
      .map(item => `${item.displayName ?? item.instanceId}: ${item.install.command.darwin}`)
    const choice = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['继续打开界面', '退出'],
      defaultId: 0,
      cancelId: 1,
      title: '没有可用的 CLI',
      message: 'Lodge 找到了基座，但没有可用的模型 CLI。',
      detail: installs.length > 0
        ? `先安装并登录一个 CLI，然后重启 Lodge：\n\n${installs.join('\n')}`
        : '请在基座里安装并登录一个 CLI，然后重启 Lodge。',
    })
    return choice.response === 0
  } catch {
    return true
  }
}

const startServer = async () => {
  serverPort = await findPort(DEFAULT_PORT)
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    CREW_PORT: String(serverPort),
    CREW_DATA_DIR: dataDir,
    CREW_BASE_URL: baseUrl,
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
    if (quitting) return
    if (serverRestarts < 1) {
      serverRestarts += 1
      log('restarting Lodge server once')
      setTimeout(() => {
        void startServer().then(port => {
          serverPort = port
          if (window !== null) void window.loadURL(`http://127.0.0.1:${port}`)
          else createWindow(port)
        }).catch(error => {
          log(`restart failed: ${error?.message ?? error}`)
          dialog.showErrorBox(APP_NAME, `Lodge 服务重启失败：${error?.message ?? error}\n日志：${logFile}`)
        })
      }, 1_000)
      return
    }
    dialog.showErrorBox(APP_NAME, `Lodge 服务已退出（code ${code}），自动重启一次后仍未恢复。日志：${logFile}`)
  })
  const healthy = await waitForHealth(serverPort)
  if (!healthy) {
    throw new Error(`Lodge 服务没有在端口 ${serverPort} 起来。日志：${logFile}`)
  }
  return serverPort
}

const stopChild = child => {
  if (child === null || child.killed) return
  try {
    child.kill('SIGTERM')
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL')
    }, 2_000).unref()
  } catch (error) {
    log(`stop failed: ${error?.message ?? error}`)
  }
}

const stopServer = () => {
  stopChild(serverProcess)
  stopChild(baseProcess)
  serverProcess = null
  baseProcess = null
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
    {
      label: '帮助',
      submenu: [
        { label: '检查更新', click: () => void shell.openExternal('https://github.com/xdfwxg/lodge/releases') },
        { label: '打开日志', click: () => void shell.openPath(logDir) },
        { label: '打开数据目录', click: () => void shell.openPath(app.getPath('userData')) },
      ],
    },
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
    ...(process.platform !== 'darwin' && existsSync(iconFile) ? { icon: iconFile } : {}),
    backgroundColor: '#f7f7f5',
    show: false,
    webPreferences: {
      preload: join(app.getAppPath(), 'electron', 'preload.cjs'),
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
  if (process.platform === 'darwin' && !app.isPackaged && existsSync(iconFile)) {
    app.dock.setIcon(iconFile)
  }
  ipcMain.handle('lodge:open-path', async (_event, target) => {
    if (typeof target !== 'string' || target.trim() === '') {
      return { ok: false, error: '缺少路径' }
    }
    const error = await shell.openPath(target.trim())
    return error === '' ? { ok: true } : { ok: false, error }
  })
  ipcMain.handle('lodge:choose-directory', async () => {
    const options = {
      title: '选择 Lodge 的项目目录',
      properties: ['openDirectory', 'createDirectory'],
    }
    const picked = window === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options)
    return picked.canceled ? null : picked.filePaths?.[0] ?? null
  })
  buildMenu()
  try {
    const base = await ensureBase()
    if (base === null) {
      app.quit()
      return
    }
    baseUrl = base
    const continueOpen = await checkCli(baseUrl)
    if (!continueOpen) {
      app.quit()
      return
    }
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
