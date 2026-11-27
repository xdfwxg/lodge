// 工具边界必须真的建立：扩展没加载时，回合诚实失败，不把全部工具露出去。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const stubbornPi = join(dir, 'fake-pi-stubborn.mjs')
const port = 18800 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-extguard-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const child = spawn(bin, ['--port', String(port), '--db', join(dataDir, 'base.db')], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, LODGE_PI_BIN: stubbornPi, LODGE_SANDBOX: 'on' },
})

const waitFor = async (check, label, tries = 120) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const client = createBaseClient({ baseUrl })

try {
  await waitFor(async () => {
    try { return (await fetch(`${baseUrl}/api/health`)).ok } catch { return false }
  }, 'health')
  const created = await client.createBot({
    name: '边界成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { soul: '你是执行官' },
  })
  const bot = created.bot
  const group = await client.createGroup({ name: '边界测试', memberIds: [bot.id] })
  await client.sendGroupMessage(group.group.id, '你好')
  const threadId = group.group.threadId ?? bot.threadId
  await waitFor(async () => {
    const messages = await client.threadMessages(threadId, 30)
    return messages.messages.some(message => String(message.text ?? '').includes('工具边界没有建立'))
  }, 'the turn fails closed when the extension does not load')
  const messages = await client.threadMessages(threadId, 30)
  // 期望是“诚实失败”，不是“随便结束了”：原因必须写在房间里。
  assert.ok(
    messages.messages.some(message => String(message.text ?? '').includes('工具边界没有建立')),
    '扩展没加载时回合并未说出「工具边界没有建立」',
  )
  assert.ok(
    !messages.messages.some(message => message.kind === 'digest' && String(message.text ?? '').trim() !== ''),
    '边界没建立时不应产出一段正常回答',
  )
  console.log('base-rs extension guard: ok')
} finally {
  child.kill('SIGTERM')
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
}
