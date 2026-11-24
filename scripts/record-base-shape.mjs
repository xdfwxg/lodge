// 从真实基座录一份“只有键名和类型”的形状；不写任何 bot 名、soul、消息或配置值。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shapeEndpoints } from '../server/base-shape.js'

const baseUrl = (process.env.CREW_BASE_URL ?? 'http://127.0.0.1:8799').replace(/\/+$/, '')
const target = fileURLToPath(new URL('../server/fixtures/base-shape.json', import.meta.url))

const get = async path => {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${(await response.text()).slice(0, 200)}`)
  return response.json()
}

try {
  const [instances, bootstrap, config] = await Promise.all([
    get('/api/instances'),
    get('/api/bots?messages=0'),
    get('/api/config'),
  ])
  const payload = {
    recordedAt: new Date().toISOString().slice(0, 10),
    endpoints: shapeEndpoints({ instances, bootstrap, config }),
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`base shape recorded: ${target}`)
} catch (error) {
  console.error(`record failed: ${error?.message ?? error}`)
  process.exitCode = 1
}
