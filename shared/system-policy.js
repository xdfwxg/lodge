import { realpathSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'

const BLOCKED_EXTENSIONS = new Set([
  '.app', '.applescript', '.bat', '.cmd', '.command', '.com', '.cpl', '.dmg', '.exe',
  '.jar', '.pkg', '.ps1', '.scpt', '.sh', '.terminal', '.tool', '.vbs', '.workflow', '.zsh', '.bash',
])
const BLOCKED_DIRECTORIES = new Set(['.app', '.bundle'])

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
