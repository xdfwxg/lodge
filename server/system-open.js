import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const openPath = async target => {
  if (typeof target !== 'string' || target.trim() === '') throw new Error('缺少路径')
  const path = target.trim()
  if (!existsSync(path)) throw new Error(`路径不存在：${path}`)
  const directory = statSync(path).isDirectory()
  if (process.platform === 'darwin') {
    await run('open', directory ? ['-a', 'Finder', path] : [path], { timeout: 10_000 })
    return
  }
  await run(process.platform === 'win32' ? 'explorer' : 'xdg-open', [path], { timeout: 10_000 })
}
