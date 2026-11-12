import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

// 本地服务替 web 调系统目录选择器；Electron 渲染层优先走 preload 的原生桥。
export const chooseDirectory = async () => {
  if (process.platform !== 'darwin') {
    throw new Error('当前系统还不支持从 web 选择目录；请粘贴目录路径')
  }
  try {
    const { stdout } = await run('osascript', [
      '-e',
      'POSIX path of (choose folder with prompt "选择 Lodge 的项目目录")',
    ], { timeout: 120_000, maxBuffer: 64 * 1024 })
    const raw = stdout.trim()
    const path = raw.length > 1 ? raw.replace(/\/$/, '') : raw
    return path === '' ? { canceled: true } : { path }
  } catch (error) {
    const output = `${error?.stderr ?? ''} ${error?.message ?? ''}`
    if (output.includes('User canceled') || output.includes('-128')) return { canceled: true }
    throw new Error(`打开目录选择器失败：${String(error?.message ?? error).trim()}`)
  }
}
