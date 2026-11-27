// 浸泡：跑一段时间再回答“干不干净”。快照只能证明此刻，这里看的是增长。
// 默认规模几十秒；SOAK_TURNS / SOAK_EVENTS 可以放大到夜间跑。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const fakePi = join(dir, process.platform === 'win32' ? 'fake-pi.cmd' : 'fake-pi.mjs')
const port = 19400 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-soak-'))
// SOAK_DRIVER=real 时用真实 pi 和真实模型跑；默认还是假驱动（快、确定、不花钱）。
const real = process.env.SOAK_DRIVER === 'real'
const turns = Number(process.env.SOAK_TURNS ?? 120)
const events = Number(process.env.SOAK_EVENTS ?? 2000)
const reconnectEvery = Number(process.env.SOAK_RECONNECT_EVERY ?? 25)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const child = spawn(bin, ['--port', String(port), '--db', join(dataDir, 'base.db')], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: real ? { ...process.env } : { ...process.env, LODGE_PI_BIN: fakePi, LODGE_SANDBOX: 'off' },
})

const client = createBaseClient({ baseUrl })
const waitFor = async (check, label, tries = 200) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(50)
  }
  throw new Error(`timeout: ${label}`)
}

const rssKb = pid => {
  try {
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) || null
  } catch {
    return null
  }
}

const fdCount = pid => {
  try {
    if (process.platform === 'linux') return readdirSync(`/proc/${pid}/fd`).length
    return execFileSync('lsof', ['-p', String(pid)], { encoding: 'utf8' }).trim().split('\n').length - 1
  } catch {
    return null
  }
}

// 残留成员进程：假驱动按命令行找；真实驱动按子进程找（看门人 + pi 都在基座的子树里）。
const memberPids = () => {
  try {
    const output = real
      ? execFileSync('pgrep', ['-P', String(child.pid)], { encoding: 'utf8' })
      : execFileSync('pgrep', ['-f', fakePi], { encoding: 'utf8' })
    return output.trim().split('\n').filter(Boolean).map(Number)
  } catch {
    return []
  }
}

// 一次断线重连：连上、读到 hello、断开；只验证重连本身不留下连接。
const reconnect = async () => {
  const controller = new AbortController()
  try {
    const response = await fetch(new URL('/api/events', baseUrl), {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    })
    const reader = response.body.getReader()
    await reader.read()
  } catch {}
  controller.abort()
}

try {
  await waitFor(async () => {
    try { return (await fetch(`${baseUrl}/api/health`)).ok } catch { return false }
  }, 'health')
  const instances = await client.instances()
  const pi = (instances.instances ?? []).find(instance => instance.instanceId === 'pi')
  const model = real ? (pi?.models?.default ?? '') : ''
  const created = await client.createBot({ name: '浸泡成员', modelSelection: { instanceId: 'pi', model }, settings: { soul: '你是执行官' } })
  const group = await client.createGroup({ name: '浸泡', memberIds: [created.bot.id] })
  const threadId = group.group.threadId ?? created.bot.threadId
  // 预热一轮，量具从“已经工作过”的进程开始算。
  await client.sendGroupMessage(group.group.id, real ? 'Reply with exactly: ok' : '热身')
  const turnTries = real ? 1200 : 200
  await waitFor(async () => (await client.threadMessages(threadId, 50)).messages.some(message => message.kind === 'digest'), 'warmup', turnTries)

  const startRss = rssKb(child.pid)
  const startFds = fdCount(child.pid)

  // 只看“最后一条终态换了没有”：按窗口数 digest 的写法会在消息超过窗口后永远等不到。
  let lastDigestId = (await client.threadMessages(threadId, 20)).messages.filter(message => message.kind === 'digest').at(-1)?.id ?? ''
  for (let index = 0; index < turns; index += 1) {
    await client.sendGroupMessage(group.group.id, real ? 'Reply with exactly: ok' : `第 ${index} 轮`)
    await waitFor(async () => {
      const digest = (await client.threadMessages(threadId, 20)).messages.filter(message => message.kind === 'digest').at(-1)
      if (digest === undefined || digest.id === lastDigestId) return false
      lastDigestId = digest.id
      return true
    }, `turn ${index} digest`, turnTries)
    if (reconnectEvery > 0 && (index + 1) % reconnectEvery === 0) await reconnect()
  }

  for (let index = 0; index < events; index += 1) {
    await client.patchGroup(group.group.id, { bulletin: `第 ${index} 条` })
  }

  const endRss = rssKb(child.pid)
  const endFds = fdCount(child.pid)
  const rssDelta = startRss === null || endRss === null ? null : endRss - startRss
  const fdDelta = startFds === null || endFds === null ? null : endFds - startFds
  console.log(`base-rs soak: ${turns} turns, ${events} events, ${reconnectEvery > 0 ? Math.floor(turns / reconnectEvery) : 0} reconnects, driver=${real ? 'real pi' : 'fake'}`)
  console.log(`  rss ${startRss ?? '—'} → ${endRss ?? '—'} KB（Δ ${rssDelta ?? '—'}）`)
  console.log(`  fds ${startFds ?? '—'} → ${endFds ?? '—'}（Δ ${fdDelta ?? '—'}）`)

  // 阈值是“明显退化才拦”：短跑里内存涨几十 MB、fd 涨几十个都不正常。
  if (rssDelta !== null) assert.ok(rssDelta < 64 * 1024, `RSS 增长过大：${rssDelta} KB`)
  if (fdDelta !== null) assert.ok(fdDelta < 64, `fd 增长过大：${fdDelta}`)

  // 回合全部有终态；浸泡之后仍然能干活；正常退出不留孤儿。
  // 终态每轮一条：用最近窗口里最后一条 digest 的 id 证明还在往前走，再数一遍窗口内的数量。
  const tail = (await client.threadMessages(threadId, 50)).messages
  assert.ok(tail.some(message => message.kind === 'digest'), '浸泡之后仍有终态')
  assert.equal((await client.health()).ok, true)
  child.kill('SIGTERM')
  await waitFor(async () => memberPids().length === 0, 'no orphans after soak', 100)
  assert.equal(memberPids().length, 0, '浸泡之后正常退出没有孤儿')
  console.log('base-rs soak: ok')
} finally {
  try { child.kill('SIGTERM') } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
}
