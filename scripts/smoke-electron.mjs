// Electron 冒烟：启动真正的桌面壳，确认窗口能连上本地服务并渲染界面，再退出。
// 用临时用户目录和假基座，不碰用户正在用的 Lodge、房间或基座资源。
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dist = join(root, 'ui', 'dist', 'index.html')
if (!existsSync(dist)) {
  console.error('smoke:electron 需要先构建界面：npm run build')
  process.exit(2)
}

const temp = mkdtempSync(join(tmpdir(), 'lodge-electron-smoke-'))
const userData = join(temp, 'userData')
const dataDir = join(temp, 'data')
let base = null
let app = null

const instances = {
  instances: [
    {
      instanceId: 'claude',
      driverKind: 'claudeAgent',
      displayName: 'Claude',
      snapshot: { state: 'available', authenticated: true },
      models: { default: 'claude-sonnet-5', options: [] },
      login: { args: ['login'], command: 'claude' },
      capabilities: {},
    },
  ],
}

const startFakeBase = () => new Promise(resolveBase => {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname
    if (path === '/api/instances') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(instances))
      return
    }
    if (path === '/api/bots') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ bots: [], groups: [] }))
      return
    }
    if (path === '/api/config') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ features: {} }))
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{}')
  })
  server.listen(0, '127.0.0.1', () => resolveBase(server))
})

const launch = baseUrl => electron.launch({
  args: [root],
  env: {
    ...process.env,
    LODGE_SMOKE: '1',
    LODGE_USER_DATA_DIR: userData,
    CREW_DATA_DIR: dataDir,
    CREW_BASE_URL: baseUrl,
    CREW_PORT: '0',
  },
  timeout: 60_000,
})

const shellPage = async launched => {
  const page = await launched.firstWindow({ timeout: 60_000 })
  await page.waitForFunction(() => {
    const rootNode = document.querySelector('#root')
    return rootNode !== null && rootNode.children.length > 0
  }, null, { timeout: 60_000 })
  const title = await page.title()
  if (title !== 'Lodge') throw new Error(`窗口标题不对：${title}`)
  return page
}

try {
  base = await startFakeBase()
  const baseUrl = `http://127.0.0.1:${base.address().port}`

  app = await launch(baseUrl)
  let page = await shellPage(app)

  // 真建一间示例房：窗口里能看见它，说明主进程、服务和界面确实接在一起。
  const seeded = await page.evaluate(async () => {
    const response = await fetch('/api/rooms/sample', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'chat' }),
    })
    return { ok: response.ok, body: await response.text() }
  })
  if (!seeded.ok) throw new Error(`示例房没有建起来：${seeded.body.slice(0, 300)}`)
  await page.reload()
  await page.getByText(/^示例：/).first().waitFor({ timeout: 30_000 })

  const shell = await page.evaluate(() => ({
    rooms: document.querySelectorAll('.crew-side-room').length,
    brand: document.body.innerText.includes('Lodge'),
  }))
  if (!shell.brand || shell.rooms === 0) throw new Error('窗口没有渲染出建好的房间')

  // 关掉再开：同一个用户目录还能看见这间房，退出和恢复都算走通。
  await app.close()
  app = await launch(baseUrl)
  page = await shellPage(app)
  await page.getByText(/^示例：/).first().waitFor({ timeout: 30_000 })
  console.log(`electron smoke: ok · Lodge · ${shell.rooms} 个房间入口 · 重开后仍在`)
} catch (error) {
  console.error(`electron smoke failed: ${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  try { await app?.close() } catch {}
  if (base !== null) await new Promise(resolveClose => base.close(resolveClose))
  rmSync(temp, { recursive: true, force: true })
}
