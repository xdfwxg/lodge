import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createJevClient } from './jev.js'

test('Jev is unavailable unless configured, and never throws', async () => {
  const client = createJevClient({ url: '' })
  const result = await client.advice({ mode: 'gate', goal: 'x' })
  assert.equal(result.available, false)
  assert.deepEqual(result.advice, [])
})

test('Jev advice is normalized and sent as a separate advisory payload', async () => {
  let received = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      received = JSON.parse(body)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ score: 0.72, reasons: ['缺少回滚测试'], risks: ['网络依赖'], model: 'jev-test' }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
    const client = createJevClient({ url: `http://127.0.0.1:${port}`, timeoutMs: 1000 })
    const result = await client.advice({ mode: 'gate', goal: '发布' })
    assert.equal(received.mode, 'gate')
    assert.equal(result.available, true)
    assert.equal(result.advice[0].score, 0.72)
    assert.deepEqual(result.advice[0].missingEvidence, undefined)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
