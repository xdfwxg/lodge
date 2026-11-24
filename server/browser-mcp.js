import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { BROWSER_MCP_BLOCKED_PATTERNS, BROWSER_MCP_SERVER_NAME } from '../shared/browser-mcp.js'

const require = createRequire(import.meta.url)
const PINNED_VERSION = '1.13.0'

// 浏览器只在独立、临时的 profile 里跑；不接日常 Chrome，也不允许输入、脚本求值和本地文件。
const FLAGS = [
  '--headless',
  '--isolated',
  '--no-usage-statistics',
  '--no-performance-crux',
  '--no-category-input',
  '--no-category-emulation',
  '--no-category-performance',
  '--no-category-network',
  '--no-category-network-mocks',
  '--no-category-memory',
  '--no-category-extensions',
  '--no-category-experimental-third-party',
  '--no-category-experimental-webmcp',
  '--no-category-pwa',
  '--no-category-webauthn',
  '--no-javascript-evaluation',
  '--no-file-navigations',
  '--screenshot-format=jpeg',
  '--screenshot-max-width=1280',
  '--screenshot-max-height=2000',
  ...BROWSER_MCP_BLOCKED_PATTERNS.map(pattern => `--blocked-url-pattern=${pattern}`),
]

const launch = () => {
  try {
    const packagePath = require.resolve('chrome-devtools-mcp/package.json')
    const packageJson = require(packagePath)
    const binary = packageJson?.bin?.['chrome-devtools-mcp']
    if (typeof binary === 'string' && binary !== '') {
      return { command: process.execPath, args: [resolve(dirname(packagePath), binary), ...FLAGS] }
    }
  } catch {
    // 没随包安装时退回 npx；仍然固定版本，避免每次拉到不同的服务器。
  }
  return { command: 'npx', args: ['-y', `chrome-devtools-mcp@${PINNED_VERSION}`, ...FLAGS] }
}

export const browserMcpConfig = () => ({
  name: BROWSER_MCP_SERVER_NAME,
  ...launch(),
})

// 每个 engine 只注册一次；按实例缓存，换驱动或测试不会共享上一次的结果。
const ready = new WeakMap()

export const ensureBrowserMcp = async engine => {
  const cacheable = engine !== null && typeof engine === 'object'
  if (cacheable && ready.has(engine)) return ready.get(engine)
  const task = (async () => {
    if (typeof engine?.mcp?.list !== 'function' || typeof engine.mcp.create !== 'function') return false
    const config = browserMcpConfig()
    const listed = await engine.mcp.list()
    const servers = Array.isArray(listed) ? listed : listed?.servers ?? []
    const existing = servers.find(server => server?.name === BROWSER_MCP_SERVER_NAME)
    if (existing !== undefined) {
      const same = existing.command === config.command &&
        JSON.stringify(existing.args ?? []) === JSON.stringify(config.args)
      if (!same && typeof engine.mcp.update === 'function') {
        const { name, ...body } = config
        await engine.mcp.update(BROWSER_MCP_SERVER_NAME, { ...body, enabled: true })
      } else if (existing.enabled === false && typeof engine.mcp.patch === 'function') {
        await engine.mcp.patch(BROWSER_MCP_SERVER_NAME, { enabled: true })
      }
      return true
    }
    const created = await engine.mcp.create({ ...config, enabled: true })
    const added = Array.isArray(created) ? created : created?.servers ?? []
    const server = added.find(item => item?.name === BROWSER_MCP_SERVER_NAME)
    if (server?.enabled === false && typeof engine.mcp.patch === 'function') {
      await engine.mcp.patch(BROWSER_MCP_SERVER_NAME, { enabled: true })
    }
    return true
  })().catch(error => {
    if (cacheable) ready.delete(engine)
    console.warn(`[lodge] 浏览器工具没有准备好：${error?.message ?? error}`)
    return false
  })
  if (cacheable) ready.set(engine, task)
  return task
}
