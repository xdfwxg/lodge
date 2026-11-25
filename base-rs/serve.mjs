// 起一个本地薄基座，给 Lodge 的 CREW_BASE_URL 指向它用。
// 用法：npm run base:rs:serve（可设 LODGE_BASE_RS_PORT / LODGE_BASE_RS_DB）
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', 'lodge-base-slice')
const port = process.env.LODGE_BASE_RS_PORT ?? '8798'
const db = resolve(process.env.LODGE_BASE_RS_DB ?? join(dir, '..', '.data', 'base-rs.db'))

const child = spawn(bin, ['--port', port, '--db', db, ...(process.argv.includes('--fake') ? ['--fake'] : [])], {
  stdio: 'inherit',
})
const stop = signal => {
  child.kill(signal)
  setTimeout(() => process.exit(0), 1500)
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
child.on('exit', code => process.exit(code ?? 0))
