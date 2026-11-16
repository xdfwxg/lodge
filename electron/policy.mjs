import { realpathSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])
const BLOCKED_EXTENSIONS = new Set([
  '.app', '.applescript', '.bat', '.cmd', '.command', '.com', '.cpl', '.dmg', '.exe',
  '.jar', '.pkg', '.ps1', '.scpt', '.sh', '.terminal', '.tool', '.vbs', '.workflow', '.zsh', '.bash',
])
const BLOCKED_DIRECTORIES = new Set(['.app', '.bundle'])

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

// 只允许打开普通文件或文件夹；可执行文件和可启动包交给系统不是“查看”。
export const openablePath = (target, { stat = statSync, realpath = realpathSync } = {}) => {
  if (typeof target !== 'string' || target.trim() === '') return { ok: false, error: '缺少路径' }
  const file = target.trim()
  let info
  try {
    info = stat(file)
  } catch {
    return { ok: false, error: '路径不存在' }
  }
  let real = file
  try {
    real = realpath(file)
  } catch {}
  const names = [file, real]
  if (info.isDirectory()) {
    if (names.some(name => BLOCKED_DIRECTORIES.has(extname(basename(name)).toLowerCase()))) {
      return { ok: false, error: '不能直接打开应用包' }
    }
    return { ok: true, path: file }
  }
  if (!info.isFile()) return { ok: false, error: '只能打开文件或文件夹' }
  if ((info.mode & 0o111) !== 0) return { ok: false, error: '不能直接打开可执行文件' }
  if (names.some(name => BLOCKED_EXTENSIONS.has(extname(basename(name)).toLowerCase()))) {
    return { ok: false, error: '不能直接打开这个类型的文件' }
  }
  return { ok: true, path: file }
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
