// Lodge 自己的浸泡：端口可达性、fd/socket 增长、SSE 反复重连、API 持续读写。
// 基座的浸泡只证明基座干净；监听反复消失是这一层的问题，所以这一层也要自己的曲线。
// 默认 20 分钟；SOAK_MINUTES 可调。任何一次探活失败都算一次“不可达”，退出码 1。
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseBin = process.env.LODGE_BASE_RS_BIN ?? join(root, 'base-rs', 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const minutes = Math.max(1, Number(process.env.SOAK_MINUTES ?? 20))
const basePort = 19700 + Math.floor(Math.random() * 100)
const lodgePort = 19800 + Math.floor(Math.random() * 100)
const baseUrl = `http://127.0.0.1:${basePort}`
const lodgeUrl = `http://127.0.0.1:${lodgePort}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-soak-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const children = []
const cleanup = () => {
  for (const child of children) {
    try { child.kill('SIGTERM') } catch {}
  }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
}

const waitFor = async (check, label, tries = 200) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const get = async (path, init = {}) => {
  const response = await fetch(`${lodgeUrl}${path}`, { ...init, signal: AbortSignal.timeout(5_000) })
  const text = await response.text()
  return { status: response.status, body: text === '' ? null : JSON.parse(text) }
}
const post = (path, body) => get(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {}),
})

const probe = async () => {
  try {
    const response = await fetch(`${lodgeUrl}/api/health`, { signal: AbortSignal.timeout(2_000) })
    return response.ok
  } catch {
    return false
  }
}

const fdsOf = pid => {
  try {
    return execFileSync('lsof', ['-p', String(pid)], { encoding: 'utf8' }).trim().split('\n').length - 1
  } catch {
    return null
  }
}
const socketsOf = pid => {
  try {
    return execFileSync('lsof', ['-nP', '-p', String(pid), '-a', '-iTCP'], { encoding: 'utf8' }).trim().split('\n').length - 1
  } catch {
    return 0
  }
}
const rssOf = pid => {
  try {
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) || null
  } catch {
    return null
  }
}

// 一次 SSE 往返：连上、读一帧、断开。模拟界面断线重连。
const sseOnce = async () => {
  const controller = new AbortController()
  try {
    const response = await fetch(`${lodgeUrl}/api/events`, {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    })
    await response.body.getReader().read()
  } catch {}
  controller.abort()
}

try {
  // 一个假驱动的基座 + 一间自己的 Lodge：不碰真实数据。
  const base = spawn(baseBin, ['--port', String(basePort), '--db', join(dataDir, 'base.db'), '--fake'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  children.push(base)
  await waitFor(async () => {
    try { return (await fetch(`${baseUrl}/api/health`)).ok } catch { return false }
  }, 'base health')

  const lodge = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      CREW_DATA_DIR: dataDir,
      CREW_WORKSPACE_ROOT: join(dataDir, 'ws'),
      CREW_REPO: root,
      CREW_BASE_URL: baseUrl,
      CREW_PORT: String(lodgePort),
      // 假基座的实例是 fake/fake/echo；没有基座默认 bot 时用它当成员模型。
      CREW_MODEL_INSTANCE: 'fake',
      CREW_MODEL: 'fake/echo',
    },
  })
  children.push(lodge)
  await waitFor(probe, 'lodge health')

  // 一间聊天室当负载：持续发消息、反复重连 SSE、每分钟看一次端口和资源。
  const created = await post('/api/rooms', { roomType: 'chat', goal: '浸泡：持续说话与重连' })
  const roomId = created.body?.room?.id
  if (created.status >= 400 || typeof roomId !== 'string') {
    throw new Error(`建房失败：${created.status} ${JSON.stringify(created.body).slice(0, 200)}`)
  }

  const samples = []
  const losses = []
  let probes = 0
  let sent = 0
  let rejected = 0
  let lastMessageAt = Date.now()
  const startedAt = Date.now()
  const deadline = startedAt + minutes * 60_000
  const baseFds = fdsOf(lodge.pid)
  const baseRss = rssOf(lodge.pid)

  while (Date.now() < deadline) {
    // 负载：每 2 秒说一句、每 10 秒重连一次 SSE。
    if (Date.now() - lastMessageAt > 2_000) {
      lastMessageAt = Date.now()
      sent += 1
      const sentResult = await post(`/api/rooms/${roomId}/messages`, { text: `第 ${sent} 批：继续。` }).catch(() => null)
      if (sentResult === null || sentResult.status >= 400) rejected += 1
    }
    if (probes % 5 === 0) await sseOnce()

    await sleep(2_000)
    probes += 1
    if (!(await probe())) {
      // 连续失败合并成一段：记开始时间和当时的现场，恢复时补结束时间。
      const last = losses.at(-1)
      if (last !== undefined && last.windowMs === undefined) continue
      losses.push({
        openAt: Date.now() - startedAt,
        fds: fdsOf(lodge.pid),
        sockets: socketsOf(lodge.pid),
        rss: rssOf(lodge.pid),
      })
      continue
    }
    const last = losses.at(-1)
    if (last !== undefined && last.windowMs === undefined) {
      last.closedAt = Date.now() - startedAt
      last.windowMs = last.closedAt - last.openAt
    }
    // 每 30 秒采一次曲线；按探活次数算，不按已采样本数算。
    if (probes === 1 || probes % 15 === 0) {
      samples.push({
        at: Date.now() - startedAt,
        fds: fdsOf(lodge.pid),
        sockets: socketsOf(lodge.pid),
        rss: rssOf(lodge.pid),
      })
    }
  }

  const endFds = fdsOf(lodge.pid)
  const endRss = rssOf(lodge.pid)
  console.log(`lodge soak: ${minutes} 分钟，房间 ${roomId}`)
  console.log(`  fds ${baseFds ?? '—'} → ${endFds ?? '—'}，sockets ${socketsOf(lodge.pid)}，RSS ${baseRss ?? '—'} → ${endRss ?? '—'} KB`)
  console.log(`  发消息 ${sent} 条，被拒 ${rejected} 条`)
  for (const sample of samples) {
    console.log(`  · ${Math.round(sample.at / 1000)}s fds=${sample.fds ?? '—'} sockets=${sample.sockets ?? '—'} rss=${sample.rss ?? '—'}`)
  }
  if (losses.length > 0) {
    console.log(`  不可达 ${losses.length} 段：`)
    for (const loss of losses) {
      console.log(`   · 从 ${Math.round((loss.openAt ?? 0) / 1000)}s 起${loss.windowMs === undefined ? '（到结束仍不可达）' : `，持续 ${Math.round(loss.windowMs / 1000)}s`}；当时 fds=${loss.fds ?? '—'} sockets=${loss.sockets ?? '—'} rss=${loss.rss ?? '—'}`)
    }
  } else {
    console.log('  不可达 0 段')
  }

  let failed = false
  if (losses.length > 0) failed = true
  // 发送被拒一半以上说明房间已经不能干活，不是“太忙了”。
  if (sent > 0 && rejected > sent / 2) {
    console.error(`  ✘ 一半以上的消息被拒：${rejected}/${sent}`)
    failed = true
  }
  if (baseFds !== null && endFds !== null && endFds - baseFds > 128) {
    console.error(`  ✘ fd 增长过大：${endFds - baseFds}`)
    failed = true
  }
  // V8 会把堆慢慢撑到自用的大小，20 分钟涨几十 MB 是正常的；这里只拦“明显在漏”的曲线。
  if (baseRss !== null && endRss !== null && endRss - baseRss > 256 * 1024) {
    console.error(`  ✘ RSS 增长过大：${endRss - baseRss} KB`)
    failed = true
  }
  const after = await probe()
  if (!after) {
    console.error('  ✘ 浸泡结束时端口不可达')
    failed = true
  }

  // 浸泡之后还能干活：房间读得回、消息写得进。
  const state = await get('/api/state').catch(() => null)
  const room = state?.body?.rooms?.find(item => item.id === roomId)
  const kept = Array.isArray(room?.messages) ? room.messages.length : 0
  console.log(`  状态里房间还在，消息 ${kept} 条`)
  if (room === undefined || kept === 0) {
    console.error('  ✘ 浸泡之后状态里读不回这间房')
    failed = true
  }
  const acceptance = await post(`/api/rooms/${roomId}/messages`, { text: '收尾：还在吗？' }).catch(() => null)
  if (acceptance === null || acceptance.status >= 400) {
    console.error(`  ✘ 浸泡之后房间不接受消息：${acceptance?.status ?? 'no-response'}`)
    failed = true
  }

  console.log(failed ? 'lodge soak: FAIL' : 'lodge soak: ok')
  process.exitCode = failed ? 1 : 0
} catch (error) {
  console.error(`lodge soak: ${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  cleanup()
}
