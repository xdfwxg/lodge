// 确定性工作室夹具：临时数据目录 + 内置 demo 种子，用来验证完成态交付卡、阶段卡与时间线。
// 用法：npm run build && node scripts/fixture-studio.mjs
// 只读样本，不写用户数据目录；Ctrl-C 退出时删除临时目录。

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'lodge-studio-fixture-'))
process.env.CREW_DATA_DIR = dataDir
process.env.CREW_PORT = process.env.CREW_PORT ?? '8790'
process.env.CREW_BASE_URL = process.env.CREW_BASE_URL ?? 'http://127.0.0.1:8799'
process.env.CREW_SEED_DEMO = '1'

const cleanup = () => rmSync(dataDir, { recursive: true, force: true })
process.on('SIGINT', () => {
  cleanup()
  process.exit(0)
})
process.on('SIGTERM', () => {
  cleanup()
  process.exit(0)
})

console.log(`fixture data: ${dataDir}`)
console.log(`fixture ui:   http://127.0.0.1:${process.env.CREW_PORT}/`)
console.log('room:         房间「README 补安装说明」是完成态工作室，带交付卡')
await import('../server/index.js')
