// 起一个本地薄基座，给 Lodge 的 CREW_BASE_URL 指向它用。
// 用法：npm run base:rs:serve（可设 LODGE_BASE_RS_PORT / LODGE_BASE_RS_DB）
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workspaceRoot } from '../server/crew/paths.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const port = process.env.LODGE_BASE_RS_PORT ?? '8798'
const db = resolve(process.env.LODGE_BASE_RS_DB ?? join(dir, '..', '.data', 'base-rs.db'))

// 受限执行（证明/反例）只接受声明过的工作根；工作副本默认在 workspaceRoot 下。
const env = { ...process.env }
if (env.LODGE_WORK_ROOTS === undefined || env.LODGE_WORK_ROOTS === '') {
  env.LODGE_WORK_ROOTS = workspaceRoot()
}

const child = spawn(bin, ['--port', port, '--db', db, ...(process.argv.includes('--fake') ? ['--fake'] : [])], {
  stdio: 'inherit',
  env,
})
const stop = signal => {
  child.kill(signal)
  setTimeout(() => process.exit(0), 1500)
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
child.on('exit', code => process.exit(code ?? 0))
