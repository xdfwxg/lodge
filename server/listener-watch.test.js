import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { createListenerWatch, rebindOnce } from './listener-watch.js'

test('a listener that stops accepting connections is reported once, not on every tick', async () => {
  const logs = []
  let lost = 0
  const watch = createListenerWatch({
    port: 8788,
    probe: async () => false,
    failures: 2,
    onLost: () => { lost += 1 },
    log: message => logs.push(message),
  })
  await watch.tick()
  assert.equal(lost, 0, '一次失败可能是抖动')
  await watch.tick()
  assert.equal(lost, 1)
  await watch.tick()
  assert.equal(lost, 1, '报过就不再重复叫人')
  assert.match(logs[0], /监听没了/)
})

test('one good connection resets the count', async () => {
  let ok = false
  let lost = 0
  const watch = createListenerWatch({
    port: 8788,
    probe: async () => ok,
    failures: 2,
    onLost: () => { lost += 1 },
    log: () => {},
  })
  await watch.tick()
  assert.equal(watch.misses, 1)
  ok = true
  await watch.tick()
  assert.equal(watch.misses, 0)
  ok = false
  await watch.tick()
  assert.equal(lost, 0)
})

test('a probe that throws counts as a miss instead of crashing the watcher', async () => {
  let lost = 0
  const watch = createListenerWatch({
    port: 8788,
    probe: async () => { throw new Error('boom') },
    failures: 1,
    onLost: () => { lost += 1 },
    log: () => {},
  })
  await watch.tick()
  assert.equal(lost, 1)
})

test('stop ends the watch: no more checks after shutdown', async () => {
  let probes = 0
  let lost = 0
  const watch = createListenerWatch({
    port: 8788,
    probe: async () => { probes += 1; return false },
    failures: 1,
    onLost: () => { lost += 1 },
    log: () => {},
  })
  watch.stop()
  await watch.tick()
  assert.equal(probes, 0)
  assert.equal(lost, 0)
})


test('after a successful rebind the watcher starts counting from zero again', async () => {
  let probes = 0
  let lost = 0
  const watch = createListenerWatch({
    port: 8788,
    probe: async () => { probes += 1; return false },
    failures: 1,
    onLost: () => { lost += 1 },
    log: () => {},
  })
  await watch.tick()
  assert.equal(lost, 1)
  watch.reset()
  await watch.tick()
  assert.equal(lost, 2, '重建之后再出事要能再叫人，不能一直沉默')
  assert.equal(probes, 2)
})


test('rebind closes the old listener and listens again; a listener that will not come back is honest about it', async () => {
  const calls = []
  const healthy = Object.assign(new EventEmitter(), {
    close: callback => { calls.push('close'); callback() },
    listen: (port, host, callback) => { calls.push(`listen:${port}:${host}`); callback() },
  })
  assert.equal(await rebindOnce(healthy, { port: 8788, verify: async () => true }), true)
  assert.deepEqual(calls, ['close', 'listen:8788:127.0.0.1'])

  // listen 回调只说明绑上了：自连不通就不算重建成功（现场见过回调成功、socket 是 CLOSED）。
  const zombie = Object.assign(new EventEmitter(), {
    close: callback => { callback() },
    listen: (port, host, callback) => { callback() },
  })
  assert.equal(await rebindOnce(zombie, { port: 8788, verify: async () => false }), false)

  const broken = Object.assign(new EventEmitter(), {
    close: callback => { callback() },
    listen: () => { throw new Error('EADDRINUSE') },
  })
  assert.equal(await rebindOnce(broken, { port: 8788 }), false)

  const silent = Object.assign(new EventEmitter(), {
    close: callback => { callback() },
    listen: () => {},
  })
  assert.equal(await rebindOnce(silent, { port: 8788, timeoutMs: 50 }), false)

  const throwing = Object.assign(new EventEmitter(), {
    close: () => { throw new Error('not running') },
    listen: () => {},
  })
  assert.equal(await rebindOnce(throwing, { port: 8788 }), false)
})

test('a port already taken is reported as a failed rebind, not an uncaught server error', async () => {
  // 端口被占用时 listen 不抛错，而是异步发 'error'；不接住它就会等到超时，
  // 或者把错误交给入口的 handler 走成整进程退出。
  const taken = Object.assign(new EventEmitter(), {
    close: callback => callback(),
    listen: () => { setImmediate(() => taken.emit('error', new Error('EADDRINUSE'))) },
  })
  const startedAt = Date.now()
  assert.equal(await rebindOnce(taken, { port: 8788, timeoutMs: 5_000 }), false)
  assert.ok(Date.now() - startedAt < 2_000, '端口占用要马上报 false，不靠超时')
})

test('rebind drops live event streams so the new listener actually comes up', async () => {
  // 真故障现场：Node 说自己在听，内核里已经没有 LISTEN，旧的 SSE 连接还挂着。
  // close() 等连接自己结束永远等不到，重建就会卡在“关了还没开”。
  const http = await import('node:http')
  const { createServer } = http
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('retry: 2000\n\n') })
  const port = 23000 + Math.floor(Math.random() * 200)
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  const stream = await new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/api/events' }, resolve)
    request.on('error', reject)
  })
  const listening = await rebindOnce(server, { port, timeoutMs: 1_000 })
  assert.equal(listening, true, '挂着的连接不能挡住重建')
  const response = await fetch(`http://127.0.0.1:${port}/api/ping`).catch(() => null)
  assert.equal(response !== null, true, '重建后端口要能接新请求')
  stream.destroy()
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(resolve))
})
