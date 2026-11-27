// 杀进程的三个时点：回合刚起、流式中、等审批。每个都要有终态和原因，不留孤儿。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const fakePi = join(dir, process.platform === 'win32' ? 'fake-pi.cmd' : 'fake-pi.mjs')
const port = 19000 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-kill-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const launch = () => spawn(bin, ['--port', String(port), '--db', join(dataDir, 'base.db')], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, LODGE_PI_BIN: fakePi, LODGE_SANDBOX: 'on' },
})
let child = launch()

const healthy = async () => {
  try { return (await fetch(`${baseUrl}/api/health`)).ok } catch { return false }
}

// 带着旧游标连一次 SSE，返回首帧（hello）和之后收到的帧。
const readSse = async (cursor, wantFrames = 1, timeoutMs = 5000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const frames = []
  let hello = null
  try {
    const response = await fetch(new URL('/api/events', baseUrl), {
      signal: controller.signal,
      headers: { accept: 'text/event-stream', ...(cursor === null ? {} : { 'last-event-id': cursor }) },
    })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (hello === null || frames.length < wantFrames) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const data = block.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n')
        const idLine = block.split('\n').find(line => line.startsWith('id: '))
        if (data === '') continue
        const parsed = JSON.parse(data)
        if (parsed.kind === 'hello') {
          hello = parsed
          if (wantFrames === 0) break
          continue
        }
        frames.push({ id: idLine?.slice(4) ?? '', frame: parsed })
        break
      }
    }
  } catch {}
  clearTimeout(timer)
  controller.abort()
  return { hello, frames }
}

const waitFor = async (check, label, tries = 100) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const fakePids = () => {
  try {
    return execFileSync('pgrep', ['-f', fakePi], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).map(Number)
  } catch {
    return []
  }
}

const client = createBaseClient({ baseUrl })

try {
  await waitFor(async () => {
    try { return (await fetch(`${baseUrl}/api/health`)).ok } catch { return false }
  }, 'health')
  const created = await client.createBot({ name: '被杀的成员', modelSelection: { instanceId: 'pi', model: '' }, settings: { soul: '你是执行官' } })
  const group = await client.createGroup({ name: '杀进程', memberIds: [created.bot.id] })

  const killPoint = async (text, delayMs) => {
    await client.sendGroupMessage(group.group.id, text)
    await sleep(delayMs)
    const pids = fakePids()
    assert.ok(pids.length > 0, `${text}: the worker is running before the kill`)
    for (const pid of pids) {
      try { process.kill(pid, 'SIGKILL') } catch {}
    }
    await waitFor(async () => {
      const messages = await client.threadMessages(group.group.threadId ?? created.bot.threadId, 50)
      return messages.messages.some(message => message.kind === 'digest')
    }, `${text}: a terminal digest`)
    const messages = await client.threadMessages(group.group.threadId ?? created.bot.threadId, 50)
    const digest = messages.messages.filter(message => message.kind === 'digest').at(-1)
    const textOfDigest = JSON.stringify(digest ?? {})
    assert.match(textOfDigest, /失败|停|退出|错误|没有|reason/i, `${text}: the terminal says why`)
    await waitFor(async () => fakePids().length === 0, `${text}: no orphan`)
  }

  await killPoint('慢', 300)
  await killPoint('流式中', 300)
  await killPoint('权限', 500)

  // 4. 杀基座再拉起：历史还在，旧游标按新流重新开始，等着的卡作废并说清。
  console.error('STEP restart with a pending card')
  const beforeRestart = (await client.threadMessages(group.group.threadId ?? created.bot.threadId, 200)).messages.length
  // 等上一轮真正收尾再发下一条：基座在回合里会拒绝第二次派发。
  const sendWhenIdle = async (text, tries = 150) => {
    for (let index = 0; index < tries; index += 1) {
      try {
        await client.sendGroupMessage(group.group.id, text)
        return
      } catch (error) {
        if (!/还在跑|先等/.test(String(error?.message ?? error))) throw error
        await sleep(200)
      }
    }
    throw new Error('sendWhileIdle: the thread never became idle')
  }
  // 崩溃前的游标：hello 里的 cursor 就是当前流的 streamId:seq。
  const beforeCrash = await readSse(null, 0)
  assert.ok(typeof beforeCrash.hello?.cursor === 'string' && beforeCrash.hello.cursor !== '', '拿到崩溃前的 SSE 游标')
  await sendWhenIdle('权限')
  await waitFor(async () => {
    const messages = await client.threadMessages(group.group.threadId ?? created.bot.threadId, 50)
    return messages.messages.some(message => message.card?.requestType === 'permission')
  }, 'a pending card before the crash')
  const card = (await client.threadMessages(group.group.threadId ?? created.bot.threadId, 200)).messages
    .filter(message => message.card?.requestType === 'permission').at(-1).card

  // 崩溃：基座和它的成员进程都不留情面。
  child.kill('SIGKILL')
  for (const pid of fakePids()) {
    try { process.kill(pid, 'SIGKILL') } catch {}
  }
  await waitFor(async () => !(await healthy()), 'the base is down')
  child = launch()
  await waitFor(healthy, 'the base is back')

  const afterRestart = await client.threadMessages(group.group.threadId ?? created.bot.threadId, 200)
  assert.ok(afterRestart.messages.length >= beforeRestart, '重启后历史还在')
  const recovered = afterRestart.messages.filter(message => message.kind === 'digest').at(-1)
  assert.match(JSON.stringify(recovered ?? {}), /重启|失败|停|没有|reason/i, '没跑完的回合补了终态和原因')
  let answered = null
  try {
    await client.respondToCard(group.group.threadId ?? created.bot.threadId, card.requestId, 'allow')
  } catch (error) {
    answered = String(error?.message ?? error)
  }
  assert.ok(answered !== null, '重启前的卡不再可答（作废，不静默等待）')

  // 旧游标属于上一条流：基座按新流从头补，hello 明确说没有续传。
  const { hello, frames } = await readSse(beforeCrash.hello.cursor, 1)
  assert.equal(hello?.resumed, false, '换了一条流：cursor 不续传')
  assert.ok(frames.length > 0, '旧游标也能收到回放（从存储补）')

  console.log('base-rs kill matrix: ok')
} finally {
  child.kill('SIGTERM')
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
}
