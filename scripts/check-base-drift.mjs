// 对比真实基座与已录形状：字段少了就是契约破了，字段多了只提示。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compareShapes, shapeEndpoints } from '../server/base-shape.js'

const baseUrl = (process.env.CREW_BASE_URL ?? 'http://127.0.0.1:8799').replace(/\/+$/, '')
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../server/fixtures/base-shape.json', import.meta.url)), 'utf8'))

const get = async path => {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  return response.json()
}

try {
  const [instances, bootstrap, config] = await Promise.all([
    get('/api/instances'),
    get('/api/bots?messages=0'),
    get('/api/config'),
  ])
  const live = shapeEndpoints({ instances, bootstrap, config })
  let failed = false
  for (const [name, expected] of Object.entries(fixture.endpoints ?? {})) {
    const { missing, extra } = compareShapes(expected, live[name])
    for (const path of missing.slice(0, 20)) {
      console.error(`✘ ${name}: 缺少 ${path}`)
      failed = true
    }
    for (const path of extra.slice(0, 10)) console.log(`· ${name}: 新增 ${path}（未录制，不影响运行）`)
    if (missing.length > 20) console.error(`✘ ${name}: 还有 ${missing.length - 20} 处缺失未列出`)
  }
  if (failed) {
    console.error('base 形状与录制不一致；确认后会改动适配层，再运行 npm run base:record 更新。')
    process.exit(1)
  }
  console.log(`base shape: ok（录制于 ${fixture.recordedAt ?? '未知日期'}）`)
} catch (error) {
  console.error(`base drift check failed: ${error?.message ?? error}`)
  process.exitCode = 1
}
