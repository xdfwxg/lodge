// 监听可达性：最贵的一次真实故障是「进程还在、端口已经不接连接」——界面全白、房间照跑。
// 这里真起一个 Lodge，把监听关掉，再让它自己发现、重建、重新可达；
// 端口被别人占住时要如实交回入口，不假装重建成功。
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createLodgeApp } from './app.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const health = async port => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_500) })).ok
  } catch {
    return false
  }
}

const waitFor = async (check, label, tries = 200) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(50)
  }
  throw new Error(`timeout: ${label}`)
}

const freePort = () => new Promise(resolve => {
  const probe = http.createServer()
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})

// 起一间自己的 Lodge：临时数据目录，基座指向一个没人接的端口。
// 启动时会去清基座里的旧资源，失败被吞掉；绝不能让测试碰真实的基座。
const boot = async ({ onListenerLost = null } = {}) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lodge-reach-'))
  const port = await freePort()
  const app = await createLodgeApp({
    root,
    onListenerLost,
    env: {
      ...process.env,
      CREW_DATA_DIR: dataDir,
      CREW_WORKSPACE_ROOT: join(dataDir, 'ws'),
      CREW_BASE_URL: 'http://127.0.0.1:1',
      CREW_PORT: String(port),
    },
  })
  await new Promise(resolve => app.server.listen(app.port, '127.0.0.1', resolve))
  return {
    app,
    dataDir,
    close: async () => {
      await app.stop()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

test('a listener that disappears comes back reachable without a restart', async () => {
  const app = await boot()
  try {
    assert.equal(await health(app.app.port), true, '一开始就可达')

    // 真实故障的形态：进程还活着，监听被关掉，端口不再接连接。
    await new Promise(resolve => app.app.server.close(resolve))
    assert.equal(await health(app.app.port), false, '关掉监听后端口不可达')

    // 自检连续两次连不上才动手，第一次只算抖动。
    await app.app.listenerWatch.tick()
    assert.equal(await health(app.app.port), false)
    await app.app.listenerWatch.tick()

    await waitFor(() => health(app.app.port), '重建后端口重新可达')
    assert.equal(app.app.listenerWatch.misses, 0, '重建之后从零计数')
    // 重建的是同一个服务实例：状态还在，不是换了进程。
    assert.equal(app.app.server.listening, true)
    // 重建之前先拍了现场：下次再出事，root cause 有据可查，不用猜。
    const snapshots = readdirSync(join(app.dataDir, 'logs')).filter(name => name.startsWith('listener-lost-') && name.endsWith('.state.json'))
    assert.ok(snapshots.length >= 1, '监听丢失要留下现场')
  } finally {
    await app.close()
  }
})

test('when the port is taken the app reports the loss instead of pretending to listen', async () => {
  let lost = 0
  const app = await boot({ onListenerLost: () => { lost += 1 } })
  const blocker = http.createServer((request, response) => response.end('other'))
  try {
    assert.equal(await health(app.app.port), true)
    await new Promise(resolve => app.app.server.close(resolve))
    await new Promise(resolve => blocker.listen(app.app.port, '127.0.0.1', resolve))

    await app.app.listenerWatch.tick()
    await app.app.listenerWatch.tick()
    await waitFor(() => lost === 1, '重建失败要交回入口')
    assert.equal(lost, 1)
    assert.equal(app.app.server.listening, false, '没有假装在监听')
  } finally {
    await new Promise(resolve => blocker.close(resolve))
    await app.close()
  }
})
