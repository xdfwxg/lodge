// 判定工具收到的完整入参在这里落一份，房间按回执里的 submissionId 取回。
// 基座活动里的 input 是给界面看的预览（节点有上限），业务判定不能读那份预览。
// 位置必须在基座沙箱也可写：home 在沙箱里只读，所以放系统临时目录。
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MAX_BYTES = 512 * 1024
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/

// macOS 上用固定的 /tmp：基座和 Lodge 都必须看到同一个目录；TMPDIR 在沙箱里可能各是各的。
export const gateSpoolDir = () => process.env.LODGE_GATE_SPOOL ||
  (process.platform === 'darwin' ? '/tmp/lodge-gate-spool' : join(tmpdir(), 'lodge-gate-spool'))

export const gcGateSubmissions = (now = Date.now()) => {
  const dir = gateSpoolDir()
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    if (!FILE_NAME.test(name)) continue
    try {
      if (now - statSync(join(dir, name)).mtimeMs > MAX_AGE_MS) {
        rmSync(join(dir, name))
        removed += 1
      }
    } catch {}
  }
  return removed
}

export const writeGateSubmission = args => {
  const text = JSON.stringify(args ?? {})
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('提交太大')
  const dir = gateSpoolDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const id = randomUUID()
  writeFileSync(join(dir, `${id}.json`), text, { mode: 0o600 })
  gcGateSubmissions()
  return id
}

export const readGateSubmission = id => {
  if (typeof id !== 'string' || !FILE_NAME.test(`${id}.json`)) return null
  try {
    return JSON.parse(readFileSync(join(gateSpoolDir(), `${id}.json`), 'utf8'))
  } catch {
    return null
  }
}
