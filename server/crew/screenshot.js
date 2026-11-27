import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

// 本机有个 Chrome 就够；没有就跳过视觉证据，不阻塞交付。
const BINARIES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

export const chromePath = () => BINARIES.find(path => existsSync(path)) ?? ''

// 只截本地文件；用独立的用户目录，不碰用户自己的浏览器配置。
// 页面以 data: URL 交给 Chrome：不透明来源读不了 file://，也跳不过去；
// 这是 agent 写的 HTML，不能让它借渲染器读到沙箱拒绝的文件。相对资源因此不加载（预览需自包含）。
const MAX_HTML = 2 * 1024 * 1024

export const captureHtml = async ({ file, out, width = 1200, height = 900 } = {}) => {
  if (typeof file !== 'string' || typeof out !== 'string' || !existsSync(file)) return null
  const chrome = chromePath()
  if (chrome === '') return null
  let page
  try {
    const bytes = readFileSync(file)
    if (bytes.length > MAX_HTML) return null
    page = `data:text/html;base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
  const profile = mkdtempSync(join(tmpdir(), 'lodge-shot-'))
  try {
    await run(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      // 渲染的是 agent 写的 HTML：把它当不可信页面，网络一律关死。
      // 不加这几条，页面里一个 <img src="https://…"> 就绕过出口门把内容送出去。
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--proxy-server=http://127.0.0.1:9',
      '--proxy-bypass-list=<-loopback>',
      '--disable-background-networking',
      '--no-pings',
      `--window-size=${width},${height}`,
      `--screenshot=${out}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--virtual-time-budget=1500',
      page,
    ], { timeout: 25_000 })
    return existsSync(out) ? out : null
  } catch {
    return null
  } finally {
    // Chrome 退出时还可能握着临时目录里的文件；清理失败不能把已经截好的图判成失败。
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
  }
}
