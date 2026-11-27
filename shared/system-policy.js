// 「这条路径能不能交给系统打开」是一份共享策略：哪些不能打开、什么算可查看。
// 判据是纯的——读文件系统的两件事由调用方注入（服务端和桌面壳各自传自己的实现），
// 共享层不碰 node:fs，界面和服务端都能直接 import。
const BLOCKED_EXTENSIONS = new Set([
  '.app', '.applescript', '.bat', '.cmd', '.command', '.com', '.cpl', '.dmg', '.exe',
  '.jar', '.pkg', '.ps1', '.scpt', '.sh', '.terminal', '.tool', '.vbs', '.workflow', '.zsh', '.bash',
])
const BLOCKED_DIRECTORIES = new Set(['.app', '.bundle'])

// 路径的两个片段用纯字符串算，免掉 node:path 依赖。
const baseNameOf = path => String(path ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
const extensionOf = path => {
  const base = baseNameOf(path)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

// 只允许打开普通文件或文件夹；可执行文件和可启动包交给系统不是“查看”。
export const openablePath = (target, { stat, realpath } = {}) => {
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
    if (names.some(name => BLOCKED_DIRECTORIES.has(extensionOf(name)))) {
      return { ok: false, error: '不能直接打开应用包' }
    }
    return { ok: true, path: file }
  }
  if (!info.isFile()) return { ok: false, error: '只能打开文件或文件夹' }
  if ((info.mode & 0o111) !== 0) return { ok: false, error: '不能直接打开可执行文件' }
  if (names.some(name => BLOCKED_EXTENSIONS.has(extensionOf(name)))) {
    return { ok: false, error: '不能直接打开这个类型的文件' }
  }
  return { ok: true, path: file }
}
