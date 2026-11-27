#!/usr/bin/env node
// 基座四个瞬间的成绩单：说一句有人接、进程死了有终态、重启历史还在、审批卡能答。
// 用 fake-pi 保证确定性和可重跑；不是模型性能评测。
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'
import { createEngine } from '../server/engine.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const fakePi = join(dir, process.platform === 'win32' ? 'fake-pi.cmd' : 'fake-pi.mjs')
const port = 19200 + Math.floor(Math.random() * 400)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-scorecard-'))
const db = join(dataDir, 'base.db')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let child = null
let unsubscribe = null
const launch = async () => {
  const startedAt = Date.now()
  child = spawn(bin, ['--port', String(port), '--db', db], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, LODGE_PI_BIN: fakePi, LODGE_SANDBOX: 'on' },
  })
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return Date.now() - startedAt
    } catch {}
    await sleep(50)
  }
  throw new Error('base did not become healthy')
}

const client = createBaseClient({ baseUrl })
const messagesOf = async threadId => (await client.threadMessages(threadId, 200)).messages
const waitFor = async (check, label, tries = 100) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(50)
  }
  throw new Error(`timeout: ${label}`)
}
const fakePids = () => {
  try {
    return execFileSync('pgrep', ['-f', fakePi], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number)
  } catch {
    return []
  }
}
const rssKb = pid => {
  try {
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) || null
  } catch {
    return null
  }
}

const results = []
const add = (name, value, ok = true) => results.push({ name, value, ok })

try {
  console.error('STEP launch')
  const startup = await launch()
  add('冷启动到 /api/health', `${startup} ms`)
  const created = await client.createBot({ name: '成绩单成员', modelSelection: { instanceId: 'pi', model: '' }, settings: { soul: '你是执行官' } })
  const bot = created.bot
  const group = await client.createGroup({ name: '成绩单', memberIds: [bot.id] })
  const threadId = group.group.threadId ?? bot.threadId
  const engine = createEngine({ client })
  const events = []
  unsubscribe = engine.subscribe({
    roomId: group.group.id,
    sessionRef: threadId,
    onEvent: event => events.push(event),
  })

  console.error('STEP 1 reply')
  // 1. 说一句，有人接：20 次，报 p50 / p95。
  const latencies = []
  for (let index = 0; index < 20; index += 1) {
    const before = (await messagesOf(threadId)).length
    const startedAt = Date.now()
    await client.sendGroupMessage(group.group.id, `你好 ${index}`)
    await waitFor(async () => (await messagesOf(threadId)).length > before + 1, 'a reply')
    latencies.push(Date.now() - startedAt)
  }
  latencies.sort((a, b) => a - b)
  const pick = ratio => latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * ratio) - 1)]
  add('说一句到有人接 p50（20 次）', `${pick(0.5)} ms`)
  add('说一句到有人接 p95（20 次）', `${pick(0.95)} ms（最快 ${latencies[0]} / 最慢 ${latencies.at(-1)}）`)

  console.error('STEP 2 kill')
  // 2. 进程被杀，有终态和原因。
  const beforeKill = (await messagesOf(threadId)).length
  await client.sendGroupMessage(group.group.id, '慢')
  await sleep(200)
  for (const pid of fakePids()) {
    try { process.kill(pid, 'SIGKILL') } catch {}
  }
  await waitFor(async () => {
    const messages = await messagesOf(threadId)
    return messages.length > beforeKill && messages.at(-1)?.kind === 'digest'
  }, 'a terminal after the kill')
  const killed = (await messagesOf(threadId)).at(-1)
  add('成员进程被杀后的终态', JSON.stringify(killed?.digest ?? killed?.text ?? '').slice(0, 80))

  console.error('STEP 3 approval')
  // 3. 审批卡断线后还能答，且只答一次（走事件，不看历史里的旧卡）。
  const beforeCard = events.length
  await client.sendGroupMessage(group.group.id, '权限')
  await waitFor(
    () => events.slice(beforeCard).some(event => event.type === 'message' && event.message?.card?.requestType === 'permission'),
    'a permission card',
  )
  const card = events.slice(beforeCard)
    .map(event => event.message?.card)
    .filter(item => item?.requestType === 'permission')
    .at(-1)
  await engine.answerCard({ sessionRef: threadId, requestId: card.requestId, behavior: 'allow' })
  await waitFor(
    () => events.slice(beforeCard).some(event => event.type === 'message' && event.message?.text === '已收到回答'),
    'the allowed turn',
  )
  add('审批卡在 HTTP 上回答', `requestId ${String(card.requestId).slice(0, 8)}…，已允许`)
  let second = null
  try {
    await engine.answerCard({ sessionRef: threadId, requestId: card.requestId, behavior: 'allow' })
  } catch (error) {
    second = String(error?.message ?? error)
  }
  add('同一张卡第二次回答', second === null ? '意外地成功了' : '被拒绝（只生效一次）', second !== null)

  console.error('STEP 4 restart')
  // 4. 杀掉基座再拉起，历史还在。
  const beforeRestart = (await messagesOf(threadId)).length
  child.kill('SIGKILL')
  await sleep(300)
  const restart = await launch()
  add('重启到 /api/health', `${restart} ms`)
  const afterRestart = await messagesOf(threadId)
  add('重启后历史', `${afterRestart.length} 条（重启前 ${beforeRestart} 条）`, afterRestart.length >= beforeRestart)

  console.error('STEP 5 resources')
  // 5. 资源与孤儿：空闲、1000 条事件之后、正常退出之后。
  add('空闲 RSS', `${rssKb(child.pid) ?? '—'} KB`)
  const beforeEvents = rssKb(child.pid)
  for (let index = 1; index <= 1000; index += 1) {
    await client.patchGroup(group.group.id, { bulletin: `第 ${index} 次写入` })
  }
  const afterEvents = rssKb(child.pid)
  add(
    '1000 条事件后的 RSS',
    `${afterEvents ?? '—'} KB（增量 ${beforeEvents === null || afterEvents === null ? '—' : afterEvents - beforeEvents} KB）`,
  )
  // 事件是真相：1000 次写入都读得回来（最后一次的值）。
  const reloaded = (await client.bootstrap()).groups.find(item => item.id === group.group.id)
  add('1000 次写入后读回最后一次', reloaded?.bulletin ?? '—', reloaded?.bulletin === '第 1000 次写入')
  child.kill('SIGTERM')
  await sleep(500)
  add('正常退出后的孤儿', `${fakePids().length} 个`, fakePids().length === 0)

  console.log('\n| 项目 | 结果 | 判定 |\n| --- | --- | --- |')
  for (const row of results) {
    console.log(`| ${row.name} | ${row.value} | ${row.ok ? '通过' : '失败'} |`)
  }
  if (results.some(row => !row.ok)) process.exitCode = 1
} finally {
  // SSE 订阅会一直占着事件循环；关掉它，脚本才能自己退出。
  try { unsubscribe?.() } catch {}
  try { child?.kill('SIGTERM') } catch {}
  for (const pid of fakePids()) {
    try { process.kill(pid, 'SIGTERM') } catch {}
  }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
}
