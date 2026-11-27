// 真实 pi 的失败面：成员进程被杀、被挂住时，基座要给出终态和原因、不留孤儿，
// 同一间房下一次还能正常完成。会调用模型，按需运行：npm run base:rs:pi:faults
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const port = 20900 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-pi-faults-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (check, label, tries = 400) => {
  for (let at = 0; at < tries; at += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const child = spawn(bin, ['--port', String(port), '--db', join(dataDir, 'base.db')], {
  stdio: ['ignore', 'inherit', 'inherit'],
})

// 基座直接起的成员进程：拿到 pid 才能像真的故障那样把它杀掉或挂住。
const memberPids = () => {
  try {
    return execFileSync('pgrep', ['-P', String(child.pid)], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).map(Number)
  } catch {
    return []
  }
}

// 基座用 process_group(0) 起成员：负 pid 才是整组（看门人 + pi），只杀看门人会留下 pi。
const signalMember = (pid, signal) => {
  try {
    process.kill(-pid, signal)
  } catch {
    process.kill(pid, signal)
  }
}

const messagesOf = threadId => client.threadMessages(threadId, 100).then(result => result.messages)
const digestCount = async threadId => (await messagesOf(threadId)).filter(message => message.kind === 'digest').length
const lastDigest = async threadId => (await messagesOf(threadId)).filter(message => message.kind === 'digest').at(-1)

let client = null

try {
  await waitFor(async () => {
    try { return (await fetch(`${baseUrl}/api/health`)).ok } catch { return false }
  }, 'health')

  client = createBaseClient({ baseUrl })
  const instances = await client.instances()
  const pi = instances.instances.find(instance => instance.instanceId === 'pi')
  assert.ok(pi, 'pi is discovered')
  assert.equal(pi.snapshot.state, 'available', 'pi is available')
  const model = pi.models?.default ?? ''

  // 1. 流式中被杀：进程没了就没有人能收尾，基座要自己给出失败终态和原因。
  const killed = (await client.createBot({
    name: '被杀的执行官',
    modelSelection: { instanceId: 'pi', model },
    settings: { lease: { read: [], write: [], exec: false, network: [] } },
  })).bot
  const killedGroup = (await client.createGroup({ name: '杀进程', memberIds: [killed.id] })).group
  await client.setupGroup(killedGroup.id, {
    action: 'complete',
    cwd: '/tmp',
    bulletin: '故障注入：杀进程',
    defaultResponder: { kind: 'member', botId: killed.id },
    followMentions: false,
  })
  const beforeKill = await digestCount(killedGroup.threadId)
  await client.sendGroupMessage(killedGroup.id, 'Write a 3000 word essay about the history of tea. Do not stop early.')
  await waitFor(async () => memberPids().length > 0, 'pi 进程起来了')
  // 等它进到模型请求里，再像 OOM/崩溃那样直接杀掉。
  await sleep(600)
  const doomed = memberPids()[0]
  assert.ok(doomed, '拿得到成员进程')
  signalMember(doomed, 'SIGKILL')
  await waitFor(async () => (await digestCount(killedGroup.threadId)) > beforeKill, '被杀回合的终态')
  const killedDigest = (await lastDigest(killedGroup.threadId)).digest
  assert.equal(killedDigest.stopReason, 'failed', '成员进程被杀的回合是 failed，不是完成')
  assert.match(String(killedDigest.reply), /没有给出终态|退出|pi/i, '终态说清是成员进程没了')
  await waitFor(async () => memberPids().length === 0, '被杀的成员进程没有留下孤儿', 100)
  console.log(`pi faults: kill → ${killedDigest.stopReason} · ${String(killedDigest.reply).slice(0, 80)}`)

  // 2. 挂住不动：预算到点要停下并说清原因；被挂住的进程也要被收掉。
  const hung = (await client.createBot({
    name: '挂住的执行官',
    modelSelection: { instanceId: 'pi', model },
    settings: {
      lease: { read: [], write: [], exec: false, network: [] },
      budget: { toolCalls: 50, maxMs: 6_000 },
    },
  })).bot
  const hungGroup = (await client.createGroup({ name: '挂住', memberIds: [hung.id] })).group
  await client.setupGroup(hungGroup.id, {
    action: 'complete',
    cwd: '/tmp',
    bulletin: '故障注入：挂住',
    defaultResponder: { kind: 'member', botId: hung.id },
    followMentions: false,
  })
  const beforeHang = await digestCount(hungGroup.threadId)
  await client.sendGroupMessage(hungGroup.id, 'Write a 3000 word essay about the history of tea. Do not stop early.')
  await waitFor(async () => memberPids().length > 0, 'pi 进程起来了')
  await sleep(600)
  const stuck = memberPids()[0]
  assert.ok(stuck, '拿得到成员进程')
  // SIGSTOP 模拟模型请求卡死：进程还在，但永远不产出下一帧。
  signalMember(stuck, 'SIGSTOP')
  await waitFor(async () => (await digestCount(hungGroup.threadId)) > beforeHang, '挂住回合的终态', 300)
  const hungDigest = (await lastDigest(hungGroup.threadId)).digest
  assert.equal(hungDigest.stopReason, 'stopped', '超时的回合是 stopped')
  assert.match(String(hungDigest.reply), /超过时间上限/, '终态说清是到时间上限')
  await waitFor(async () => memberPids().length === 0, '挂住的成员进程也被收掉', 100)
  console.log(`pi faults: hang → ${hungDigest.stopReason} · ${String(hungDigest.reply).slice(0, 80)}`)

  // 3. 两次故障之后，同一间房下一次还能正常完成。
  const beforeRecovery = await digestCount(hungGroup.threadId)
  await client.sendGroupMessage(hungGroup.id, 'Reply with exactly: ok')
  await waitFor(async () => (await digestCount(hungGroup.threadId)) > beforeRecovery, '恢复回合', 300)
  const recovery = (await lastDigest(hungGroup.threadId)).digest
  assert.equal(recovery.stopReason, 'completed', '故障之后下一回合照常完成')
  console.log(`pi faults: recovery → ${recovery.stopReason}`)
  console.log('base-rs pi faults: ok')
} finally {
  try { child.kill('SIGTERM') } catch {}
  for (const pid of memberPids()) {
    try { process.kill(pid, 'SIGKILL') } catch {}
  }
  rmSync(dataDir, { recursive: true, force: true })
}
