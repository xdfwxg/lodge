import { realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'

export { openablePath } from '../shared/system-policy.js'

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

export const sameOrigin = (url, origin) => {
  try {
    return new URL(url).origin === new URL(origin).origin
  } catch {
    return false
  }
}

export const externalUrl = url => {
  try {
    const parsed = new URL(url)
    return EXTERNAL_PROTOCOLS.has(parsed.protocol) ? parsed.href : null
  } catch {
    return null
  }
}

const LOGIN_BINARIES = new Set([
  'aider', 'antigravity', 'claude', 'codex', 'gemini', 'goose', 'muse', 'opencode', 'pi', 'qwen',
])

// 登录命令来自基座响应；只接受已知 CLI，不能让它指定任意可执行文件。
export const loginBinary = (candidate, { realpath = realpathSync, stat = statSync } = {}) => {
  if (typeof candidate !== 'string' || candidate.trim() === '') return null
  const value = candidate.trim()
  if (!isAbsolute(value)) return LOGIN_BINARIES.has(value.toLowerCase()) ? value : null
  let real
  try {
    real = realpath(value)
  } catch {
    return null
  }
  let info
  try {
    info = stat(real)
  } catch {
    return null
  }
  if (!info.isFile()) return null
  const name = basename(real).toLowerCase().replace(/\.(exe|cmd|bat)$/, '')
  return LOGIN_BINARIES.has(name) ? real : null
}

// runtime 包里的 binary 必须留在自己的目录里，不能借 ../ 或绝对路径执行外部程序。
export const runtimeBinary = (dir, binary, { stat = statSync, realpath = realpathSync } = {}) => {
  if (typeof dir !== 'string' || dir === '') return null
  if (typeof binary !== 'string' || binary.trim() === '' || isAbsolute(binary)) return null
  const root = realpath(dir)
  const target = resolve(root, binary)
  let real
  try {
    real = realpath(target)
  } catch {
    return null
  }
  const rel = relative(root, real)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  try {
    if (!stat(real).isFile()) return null
  } catch {
    return null
  }
  return real
}
