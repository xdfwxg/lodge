import { app, BrowserWindow, Menu, Notification, dialog, ipcMain, session, shell } from 'electron'
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import {
  baseEntryOf, findBundledRuntimes, findNode, findPort, isBaseUp, runtimeRoots,
  waitForBase, waitForHealth,
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
let baseDir = null
let baseUrl = process.env.CREW_BASE_URL ?? ''
let quitting = false
let serverRestarts = 0
let runtimeLogins = []
let menuRooms = []
let lastNeedsCount = 0

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

const findBaseDir = () => {
  const preferred = [
    process.env.LODGE_BASE_DIR,
    readSettings().baseDir,
    join(process.resourcesPath, 'base'),
    join(app.getAppPath(), '..', 'crew-chat-base'),
    join(homedir(), 'workspace', 'crew-chat-base'),
  ].filter(item => typeof item === 'string' && item !== '')
  for (const candidate of preferred) {
    if (baseEntryOf(candidate) !== null) return candidate
  }
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
  const entry = baseEntryOf(dir)
  if (entry === null) throw new Error('基座目录里没有可运行的入口')
  let node = process.execPath
  let args = ['--experimental-strip-types', entry.file]
  const bundled = entry.kind === 'bundled'
  if (bundled) {
    args = [entry.file]
  } else {
    node = findNode()
    if (node === null) {
      await dialog.showMessageBox({
        type: 'error',
        buttons: ['退出'],
        message: '没有找到 Node.js',
        detail: '这个基座是源码目录，需要 Node.js 24 或更高版本。安装后重启 Lodge。',
      })
      return null
    }
  }
  const port = await findPort(DEFAULT_BASE_PORT)
  const baseData = join(app.getPath('userData'), 'base-data')
  mkdirSync(baseData, { recursive: true })
  const extraPath = [
    ...bundledRuntimes().map(runtime => runtime.dir),
    process.env.OMB_EXTRA_PATH,
  ].filter(Boolean).join(delimiter)
  const child = spawn(node, [
    ...args,
    'serve',
    '--port', String(port),
    '--data-dir', baseData,
  ], {
    cwd: dir,
    env: {
      ...process.env,
      ...(bundled ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      LODGE_BASE_DIR: dir,
      ...(extraPath === '' ? {} : { OMB_EXTRA_PATH: extraPath }),
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
  // 只认显式配置的基座；默认端口上可能是另一个 OpenMausBot 桌面应用，
  // 它的数据与信任策略都不属于 Lodge，不能悄悄接管。
  if (baseUrl !== '' && await isBaseUp(baseUrl)) return baseUrl
  let dir = findBaseDir()
  if (dir === null) dir = await chooseBaseDir()
  if (dir === null) return null
  return startBase(dir)
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
    stopServer()
  })
}
