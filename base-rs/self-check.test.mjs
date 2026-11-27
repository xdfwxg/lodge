// 启动自检：边界立不起来时，基座要说清并拒绝开回合，而不是带着全部工具裸奔。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const stubborn = join(dir, 'fake-pi-no-extension.mjs')
const port = 18900 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-selfcheck-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const child = spawn(bin, ['--port', String(port), '--db', join(dataDir, 'base.db')], {
  stdio: ['ignore', 'inherit', 'inherit'],
  // 沙箱关掉，让这一条只验证“pi 不认 -e”这一种自检问题。
  env: { ...process.env, LODGE_PI_BIN: stubborn, LODGE_SANDBOX: 'off' },
})

const client = createBaseClient({ baseUrl })
const waitFor = async (check, label, tries = 100) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

try {
  await waitFor(async () => {
    try { return (await fetch(`${baseUrl}/api/health`)).ok } catch { return false }
  }, 'health')

  // 1. 健康检查如实回答：自检没过，原因写清楚。
  const health = await client.health()
  assert.equal(health.self_check.ok, false)
  assert.ok(health.self_check.problems.some(problem => /-e|--extension/.test(problem)), '原因要指出 pi 不认扩展入口')

  // 2. 新回合被拒绝，原因带回来，而不是悄悄跑起来。
  const created = await client.createBot({
    name: '边界成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { soul: '你是执行官' },
  })
  const group = await client.createGroup({ name: '自检群', memberIds: [created.bot.id] })
  let refused = null
  try {
    await client.sendGroupMessage(group.group.id, '你好')
  } catch (error) {
    refused = String(error?.message ?? error)
  }
  assert.ok(refused !== null, '自检没过时必须拒绝')
  assert.match(refused, /基座自检没通过/)
  assert.match(refused, /-e|--extension/)

  // 3. 被拒绝的回合没有起过：线程里没有 digest。
  const messages = await client.threadMessages(group.group.threadId ?? created.bot.threadId, 50)
  assert.ok(!messages.messages.some(message => message.kind === 'digest'), '拒绝之后不该留下一个跑过的回合')

  console.log('base-rs self check: ok')
} finally {
  child.kill('SIGTERM')
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
}
