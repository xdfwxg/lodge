// 基座事件流的连接生命周期：断了要退避、关掉要把 socket 还回去。
// 真实现场：一次半小时的会话攒了 800 多个 CLOSED socket，最后把 Lodge 的监听挤死。
import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { createBaseClient } from './base.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const sockets = () => process.getActiveResourcesInfo().filter(item => item === 'TCPSocketWrap').length

const listen = server => new Promise(resolve => {
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
})

test('a broken event stream is retried with backoff, not in a tight loop', async () => {
  let attempts = 0
  const server = http.createServer((request, response) => {
    attempts += 1
    // 连接一开始就断：模拟基座忙、重启或被掐断。
    response.destroy()
  })
  const baseUrl = await listen(server)
  const client = createBaseClient({ baseUrl })
  const controller = new AbortController()
  void client.watchEvents({ signal: controller.signal, retryMs: 20, onState: () => {} })
  await sleep(600)
  controller.abort()
  await sleep(50)
  server.close()
  // 固定 20ms 重试会撞出 30 次以上；退避后 600ms 内只该有几次。
  assert.ok(attempts <= 8, `重连太密：600ms 里试了 ${attempts} 次`)
  assert.ok(attempts >= 2, '断了还是要重连')
})

test('aborting the watch releases the connection instead of leaking it', async () => {
  let accepted = 0
  let closed = 0
  const server = http.createServer((request, response) => {
    accepted += 1
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: {"kind":"hello"}\n\n')
    request.on('close', () => { closed += 1 })
  })
  const baseUrl = await listen(server)
  const client = createBaseClient({ baseUrl })
  const controller = new AbortController()
  let frames = 0
  void client.watchEvents({ signal: controller.signal, retryMs: 20, onFrame: () => { frames += 1 } })
  await sleep(100)
  assert.ok(frames >= 1, '先收到一帧')
  const before = sockets()
  controller.abort()
  await sleep(200)
  assert.equal(closed, accepted, '取消之后服务端看到每条连接都关了')
  assert.ok(sockets() <= before, `取消之后 socket 没有减少：${before} → ${sockets()}`)
  server.close()
})
