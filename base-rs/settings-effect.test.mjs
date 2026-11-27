// 设置写进记录不算数，要证明它真的到了一次回合：
// 用 fake-pi 把驱动交过去的东西（cwd、工具授权、审批级别、代理）原样回显，
// 再用预算停一次回合——这是「写入生效」而不是「写入读得回」。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const fakePi = join(dir, process.platform === 'win32' ? 'fake-pi.cmd' : 'fake-pi.mjs')
const port = 19300 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-settings-'))
const turnDir = mkdtempSync(join(tmpdir(), 'lodge-base-settings-cwd-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// 驱动会把工作目录规范化（/var ↔ /private/var），断言按 realpath 比。
const real = path => realpathSync(path)

const child = spawn(bin, ['--port', String(port), '--db', join(dataDir, 'base.db')], {
  stdio: ['ignore', 'inherit', 'inherit'],
  // 沙箱关掉：这一条只验证“设置到没到驱动”，不混入沙箱差异。
  env: { ...process.env, LODGE_PI_BIN: fakePi, LODGE_SANDBOX: 'off' },
})

const client = createBaseClient({ baseUrl })
const waitFor = async (check, label, tries = 120) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const messagesOf = threadId => client.threadMessages(threadId, 100).then(result => result.messages)
const lastChat = async threadId => (await messagesOf(threadId)).filter(message => message.kind === 'text').at(-1)

try {
  await waitFor(async () => {
    try { return (await fetch(`${baseUrl}/api/health`)).ok } catch { return false }
  }, 'health')

  const created = await client.createBot({
    name: '设置成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: {
      soul: '你是执行官',
      cwd: turnDir,
      nativeTools: ['read', 'bash'],
      approvalMode: 'auto',
      network: 'none',
      budget: { toolCalls: 50, maxMs: 30_000 },
    },
  })
  const bot = created.bot
  const group = await client.createGroup({ name: '设置生效', memberIds: [bot.id] })
  const threadId = group.group.threadId ?? bot.threadId

  // 1. 创建时写的设置到了一次真实的驱动回合。
  const before = (await messagesOf(threadId)).length
  await client.sendGroupMessage(group.group.id, 'ECHO_ENV')
  await waitFor(async () => (await messagesOf(threadId)).some(message => message.kind === 'digest'), 'first digest')
  const first = JSON.parse((await lastChat(threadId)).text)
  assert.equal(first.cwd, real(turnDir), 'settings.cwd 是回合的工作目录')
  assert.equal(first.granted, 'bash,read', '工具授权按声明下发（排序后）')
  assert.equal(first.approval, 'auto', '审批级别下发')
  assert.equal(first.httpProxy, null, 'network:none 的成员拿不到代理')
  assert.equal((await messagesOf(threadId)).length > before, true)

  // 2. PATCH 之后，同一个成员的下一次回合用的是新设置，不是旧快照。
  await client.patchBot(bot.id, {
    cwd: dataDir,
    nativeTools: ['read'],
    approvalMode: 'ask',
    network: 'proxy',
  })
  await client.sendGroupMessage(group.group.id, 'ECHO_ENV')
  await waitFor(async () => (await messagesOf(threadId)).filter(message => message.kind === 'digest').length >= 2, 'second digest')
  const second = JSON.parse((await lastChat(threadId)).text)
  assert.equal(second.cwd, real(dataDir), 'PATCH 后的 cwd 生效')
  assert.equal(second.granted, 'read', 'PATCH 后的工具授权生效')
  assert.equal(second.approval, 'ask', 'PATCH 后的审批级别生效')
  assert.match(String(second.httpProxy), /^http:\/\/127\.0\.0\.1:\d+$/, 'network:proxy 时回合经代理')

  // 3. 预算也是设置：声明 1 次工具调用，发 3 次就必须在第 1 次之后停下并说清原因。
  await client.patchBot(bot.id, { budget: { toolCalls: 1, maxMs: 30_000 } })
  await client.sendGroupMessage(group.group.id, '多步：3')
  await waitFor(async () => (await messagesOf(threadId)).filter(message => message.kind === 'digest').length >= 3, 'third digest')
  const digest = (await messagesOf(threadId)).filter(message => message.kind === 'digest').at(-1)
  assert.equal(digest.digest.stopReason, 'stopped', '超过工具调用上限的回合是 stopped')
  assert.match(String(digest.digest.reply), /工具调用到上限|上限/, '终态说清为什么停')

  console.log('base-rs settings effect: ok')
} finally {
  child.kill('SIGTERM')
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  try { rmSync(turnDir, { recursive: true, force: true }) } catch {}
}
