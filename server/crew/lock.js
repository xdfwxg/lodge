import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'

const alive = pid => {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 数据目录锁：同一份 .data 只能有一个 Crew 实例。
export const acquireDataLock = dataDir => {
  mkdirSync(dataDir, { recursive: true })
  const file = join(dataDir, '.lock')
  const take = () => {
    const fd = openSync(file, 'wx')
    try {
      writeSync(fd, String(process.pid))
    } finally {
      closeSync(fd)
    }
  }
  try {
    take()
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    let pid = NaN
    try {
      pid = Number(readFileSync(file, 'utf8').trim())
    } catch {
      pid = NaN
    }
    if (alive(pid)) throw new Error(`另一个 Crew 实例正在使用 ${dataDir}（pid ${pid}）`)
    try {
      unlinkSync(file)
    } catch {}
    take()
  }

  const release = () => {
    try {
      if (Number(readFileSync(file, 'utf8').trim()) === process.pid) unlinkSync(file)
    } catch {}
  }
  process.once('exit', release)
  process.once('SIGINT', () => { release(); process.exit(130) })
  process.once('SIGTERM', () => { release(); process.exit(143) })
  return release
}
