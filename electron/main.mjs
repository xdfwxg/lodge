import { app, BrowserWindow, Menu, Notification, dialog, ipcMain, session, shell } from 'electron'
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import {
  findBundledRuntimes, findPort, isBaseUp, probePort, runtimeRoots, waitForBase, waitForHealth,
} from './launch.mjs'
import { menuTemplate } from './menu.mjs'
import { attentionDecision, roomsPayload } from './attention.mjs'
import { navigationTarget, windowOptions } from './navigation.mjs'
import { openPath, runtimeLogin } from './ipc.mjs'
import { loginEntry } from './runtime-login.mjs'

const APP_NAME = 'Lodge'
const DEFAULT_PORT = 8787
const DEFAULT_BASE_PORT = 8799
const smoke = process.env.LODGE_SMOKE === '1'

// 冒烟测试用自己的用户目录：单实例锁、数据和日志都不碰用户正在用的 Lodge。
if (typeof process.env.LODGE_USER_DATA_DIR === 'string' && process.env.LODGE_USER_DATA_DIR !== '') {
  app.setPath('userData', resolve(process.env.LODGE_USER_DATA_DIR))
}

const appRoot = app.isPackaged ? join(process.resourcesPath, 'app') : app.getAppPath()
const iconFile = app.isPackaged
  ? join(process.resourcesPath, 'icon.png')
  : join(app.getAppPath(), 'build', 'icon.png')
const dataDir = join(app.getPath('userData'), 'data')
const logDir = join(app.getPath('userData'), 'logs')
const logFile = join(logDir, 'server.log')
const settingsFile = join(app.getPath('userData'), 'settings.json')

let window = null
let serverProcess = null
let serverPort = null
let baseProcess = null
let baseUrl = process.env.CREW_BASE_URL ?? ''
let quitting = false
let serverRestarts = 0
let serverProbe = null

// 连续两次拒连（约 4 秒）就认定服务半死：杀掉子进程，走既有的一次重启。
// 监听被内核悄悄关掉、而进程内信号全错的时候，只有外面看得见。
const watchServerPort = port => {
  stopWatchingServer()
  let misses = 0
  const timer = setInterval(() => {
    void probePort(port).then(state => {
      if (state !== 'refused') {
        misses = 0
        return
      }
      misses += 1
      if (misses < 2) return
      misses = 0
      log(`server port ${port} refused twice from outside; restarting`)
      if (serverProcess !== null && serverProcess.exitCode === null && serverProcess.signalCode === null) {
        serverProcess.kill('SIGKILL')
      }
    }).catch(() => {})
  }, 2_000)
  timer.unref?.()
  serverProbe = timer
}

const stopWatchingServer = () => {
  if (serverProbe === null) return
  clearInterval(serverProbe)
  serverProbe = null
}
let runtimeLogins = []
let menuRooms = []
let lastNeedsCount = 0
// 服务端生成的一次性写操作令牌；只在本进程内存里，不写环境、不写日志。
let actionToken = null
let tokenWaiters = []

const resetActionToken = () => {
  const waiting = tokenWaiters
  tokenWaiters = []
  actionToken = null
  for (const resolve of waiting) resolve(null)
}

const whenActionToken = (timeoutMs = 5_000) => {
  if (actionToken !== null) return Promise.resolve(actionToken)
  return new Promise(resolve => {
    let settled = false
    const settle = value => {
      if (settled) return
      settled = true
      resolve(value)
    }
    tokenWaiters.push(settle)
    setTimeout(() => settle(null), timeoutMs).unref?.()
  })
}

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

const bundledRuntimes = () => findBundledRuntimes({
  roots: runtimeRoots({
    env: process.env,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  }),
})

// 只有这一种基座：显式给了二进制就用它；打包版的二进制放 resources/base-rs。
// 找不到就启动失败并说清怎么构建，不再偷偷换实现。
const rustBasePath = () => {
  const explicit = process.env.LODGE_BASE_RS_BIN
  if (typeof explicit === 'string' && explicit !== '' && existsSync(explicit)) return explicit
  const bundled = join(process.resourcesPath, 'base-rs', 'lodge-base-slice')
  return existsSync(bundled) ? bundled : null
}

const startRustBase = async () => {
  const binary = rustBasePath()
  if (binary === null) return null
  const port = await findPort(DEFAULT_BASE_PORT)
  const baseData = join(app.getPath('userData'), 'base-data-rs')
  mkdirSync(baseData, { recursive: true })
  const roots = process.env.CREW_WORKSPACE_ROOT
  const child = spawn(binary, ['--port', String(port), '--db', join(baseData, 'base.db')], {
    env: {
      ...process.env,
      // 受限执行只接受声明过的工作根；没设就用基座与 Lodge 共同的那条默认（~/CrewWorkspaces）。
      ...(typeof roots === 'string' && roots !== '' ? { LODGE_WORK_ROOTS: roots } : {}),
      LODGE_SANDBOX: process.env.LODGE_SANDBOX ?? 'on',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => log(`base out: ${chunk.toString().trimEnd()}`))
  child.stderr.on('data', chunk => log(`base err: ${chunk.toString().trimEnd()}`))
  child.on('error', error => log(`base spawn failed: ${error?.message ?? error}`))
  child.on('exit', code => {
    log(`base exited: ${code}`)
    if (!quitting) log('base stopped unexpectedly')
  })
  baseProcess = child
  baseUrl = `http://127.0.0.1:${port}`
  const healthy = await waitForBase(baseUrl)
  if (!healthy) {
    try { child.kill('SIGTERM') } catch {}
    baseProcess = null
    throw new Error(`基座没有在端口 ${port} 起来。日志：${logFile}`)
  }
  return baseUrl
}

const ensureBase = async () => {
  // 只认显式配置的基座；默认端口上可能是别的应用，数据与信任策略都不属于 Lodge。
  if (baseUrl !== '' && await isBaseUp(baseUrl)) return baseUrl
  if (rustBasePath() === null) {
    throw new Error(
      '没有找到基座可执行文件：打包版应在 Resources/base-rs/lodge-base-slice，开发时先跑 npm run base:rs:build，或用 LODGE_BASE_RS_BIN 指定。',
    )
  }
  return startRustBase()
}

const checkCli = async url => {
  try {
    let data = null
    // Engine snapshots finish probing just after the HTTP port opens; wait briefly for
    // a login-capable runtime so its prompt is not missed on the first read.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const response = await fetch(`${url}/api/instances`, { signal: AbortSignal.timeout(2_000) })
        data = await response.json()
      } catch {
        data = null
      }
      const seen = (data?.instances ?? []).filter(item => item?.snapshot?.state === 'available')
      runtimeLogins = seen.filter(item => Array.isArray(item.login?.args) && item.login.args.length > 0)
      if (runtimeLogins.length > 0 || attempt === 9) break
      await new Promise(resolve => setTimeout(resolve, 400))
    }
    const available = (data?.instances ?? []).filter(item => item?.snapshot?.state === 'available')
    buildMenu()
    if (available.length > 0) {
      await promptRuntimeLogins()
      return true
    }
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
    LODGE_DESKTOP: '1',
  }
  resetActionToken()
  serverProcess = spawn(process.execPath, [join(appRoot, 'server', 'index.js')], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdoutBuffer = ''
  serverProcess.stdout.on('data', chunk => {
    stdoutBuffer += chunk.toString()
    let newline = stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).replace(/\r$/, '')
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      const match = line.match(/^LODGE_ACTION_TOKEN (\S+)$/)
      if (match) {
        actionToken = match[1]
        const waiting = tokenWaiters
        tokenWaiters = []
        for (const resolve of waiting) resolve(actionToken)
      } else if (line !== '') {
        log(`out: ${line}`)
      }
      newline = stdoutBuffer.indexOf('\n')
    }
  })
  serverProcess.stderr.on('data', chunk => log(`err: ${chunk.toString().trimEnd()}`))
  serverProcess.on('exit', code => {
    stopWatchingServer()
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
  watchServerPort(serverPort)
  return serverPort
}

const stopChild = child => {
  if (child === null || child.exitCode !== null || child.signalCode !== null) return
  try {
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
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

const promptRuntimeLogins = async () => {
  const saved = readSettings().runtimeLoginsDismissed
  const dismissed = saved !== null && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  const pending = runtimeLogins.filter(instance => {
    if (dismissed[instance.instanceId] === true) return false
    return !(instance.models?.default || (instance.models?.options?.length ?? 0) > 0)
  })
  if (pending.length === 0) return
  const instance = pending[0]
  const name = instance.displayName ?? instance.instanceId
  const choice = await dialog.showMessageBox({
    type: 'info',
    buttons: [`登录 ${name}`, '稍后'],
    defaultId: 0,
    cancelId: 1,
    title: `${name} 还没登录`,
    message: '内置 runtime 不带模型凭据，需要登录你自己的模型账号。',
    detail: '登录会打开终端；完成后重启 Lodge，建房时才能选择它。',
  })
  if (choice.response === 0) openRuntimeLogin(instance)
  else writeSettings({ runtimeLoginsDismissed: { ...dismissed, [instance.instanceId]: true } })
}

const openRuntimeLogin = instance => {
  const entry = loginEntry({
    instance,
    bundled: bundledRuntimes().find(runtime => runtime.id === instance.instanceId),
    platform: process.platform,
    userDataDir: app.getPath('userData'),
  })
  if (entry === null) {
    dialog.showErrorBox(APP_NAME, `${instance.displayName ?? instance.instanceId} 没有可用的登录命令。`)
    return
  }
  if (entry.kind === 'folder') {
    void shell.openPath(entry.path)
    return
  }
  writeFileSync(entry.file, entry.text, { mode: 0o755 })
  try {
    execFileSync('open', ['-a', 'Terminal', entry.file], { timeout: 5_000 })
  } catch (error) {
    dialog.showErrorBox(APP_NAME, `没有打开终端：${error?.message ?? error}`)
  }
}

const revealWindow = () => {
  if (window === null) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}

const sendToWindow = (channel, payload) => {
  if (!revealWindow()) return
  window.webContents.send(channel, payload)
}

const buildMenu = () => {
  const template = menuTemplate({
    platform: process.platform,
    appName: APP_NAME,
    packaged: app.isPackaged,
    rooms: menuRooms,
    logins: runtimeLogins,
    actions: {
      send: sendToWindow,
      login: openRuntimeLogin,
      openExternal: url => void shell.openExternal(url),
      openLogs: () => void shell.openPath(logDir),
      openData: () => void shell.openPath(app.getPath('userData')),
    },
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const createWindow = port => {
  window = new BrowserWindow(windowOptions({
    platform: process.platform,
    packaged: app.isPackaged,
    iconFile: existsSync(iconFile) ? iconFile : '',
    preload: join(app.getAppPath(), 'electron', 'preload.cjs'),
  }))
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  const origin = `http://127.0.0.1:${port}`
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = navigationTarget(url, origin)
    if (target.action === 'external') void shell.openExternal(target.url)
    return { action: target.action === 'allow' ? 'allow' : 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const target = navigationTarget(url, origin)
    if (target.action === 'allow') return
    event.preventDefault()
    if (target.action === 'external') void shell.openExternal(target.url)
  })
  if (!smoke) window.once('ready-to-show', () => window?.show())
  void window.loadURL(origin)
  window.on('closed', () => { window = null })
}

const fromAppWindow = event => {
  const frame = event?.senderFrame
  if (frame === null || typeof frame?.url !== 'string') return false
  try {
    const url = new URL(frame.url)
    return url.hostname === '127.0.0.1' && Number(url.port) === serverPort
  } catch {
    return false
  }
}

const boot = async () => {
  app.setName(APP_NAME)
  if (process.platform === 'darwin' && !app.isPackaged && existsSync(iconFile)) {
    app.dock.setIcon(iconFile)
  }
  ipcMain.handle('lodge:runtime-login', (_event, id) => runtimeLogin({
    id,
    baseUrl,
    open: openRuntimeLogin,
  }))
  ipcMain.handle('lodge:open-path', (_event, target) => openPath(target, {
    open: path => shell.openPath(path),
  }))
  const allowedPermissions = new Set(['clipboard-sanitized-write'])
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(allowedPermissions.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowedPermissions.has(permission))
  // 写操作从渲染层走主进程：令牌只在主进程和服务端内存里，执行官的 curl 拿不到。
  ipcMain.handle('lodge:request', async (event, path, body) => {
    if (!fromAppWindow(event)) return { ok: false, status: 403, body: { error: '只接受 Lodge 窗口的请求' } }
    if (typeof path !== 'string' || !path.startsWith('/api/') || path.startsWith('/api//') || path.includes('://')) {
      return { ok: false, status: 400, body: { error: '不支持的请求' } }
    }
    if (serverPort === null) return { ok: false, status: 503, body: { error: 'Lodge 服务还没有起来' } }
    const token = await whenActionToken()
    const headers = { 'content-type': 'application/json' }
    if (typeof token === 'string' && token !== '') headers['x-lodge-action'] = token
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(30_000),
      })
      const text = await response.text()
      let data = {}
      try {
        data = text === '' ? {} : JSON.parse(text)
      } catch {
        data = { error: text.slice(0, 500) }
      }
      return { ok: response.ok, status: response.status, body: data }
    } catch (error) {
      return { ok: false, status: 502, body: { error: `没能连上 Lodge 服务：${error?.message ?? error}` } }
    }
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
  // 渲染层只报“有几个房间需要你”；菜单和角标由主进程统一维护。
  ipcMain.on('lodge:rooms', (_event, rooms) => {
    menuRooms = roomsPayload(rooms)
    buildMenu()
  })
  ipcMain.on('lodge:attention', (_event, payload) => {
    const decision = attentionDecision({
      payload,
      supported: Notification.isSupported(),
      focused: window !== null && window.isFocused(),
    })
    if (decision.count !== lastNeedsCount) {
      lastNeedsCount = decision.count
      app.setBadgeCount(decision.count)
    }
    if (decision.notify === null) return
    const notification = new Notification({
      title: decision.notify.title,
      body: decision.notify.body,
    })
    notification.on('click', () => sendToWindow('lodge:open-room', decision.notify.roomId))
    try {
      notification.show()
    } catch {}
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
    if (window === null) {
      if (serverPort !== null) createWindow(serverPort)
      return
    }
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
    stopWatchingServer()
    stopServer()
  })
}
