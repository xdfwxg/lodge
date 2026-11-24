import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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
export const captureHtml = async ({ file, out, width = 1200, height = 900 } = {}) => {
  if (typeof file !== 'string' || typeof out !== 'string' || !existsSync(file)) return null
  const chrome = chromePath()
  if (chrome === '') return null
  const profile = mkdtempSync(join(tmpdir(), 'lodge-shot-'))
  try {
    await run(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      `--screenshot=${out}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--virtual-time-budget=1500',
      `file://${file}`,
    ], { timeout: 25_000 })
    return existsSync(out) ? out : null
  } catch {
    return null
  } finally {
    // Chrome 退出时还可能握着临时目录里的文件；清理失败不能把已经截好的图判成失败。
    try { rmSync(profile, { recursive: true, force: true }) } catch {}
  }
}
