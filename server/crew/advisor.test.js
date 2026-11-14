import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createAdvisorClient } from './advisor.js'

test('advisor is unavailable unless configured, and never throws', async () => {
  const client = createAdvisorClient({ url: '' })
  const result = await client.advice({ mode: 'gate', goal: 'x' })
  assert.equal(result.available, false)
  assert.deepEqual(result.advice, [])
})

test('advisor advice is normalized and sent as a separate advisory payload', async () => {
  let received = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      received = JSON.parse(body)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ score: 0.72, reasons: ['缺少回滚测试'], risks: ['网络依赖'], model: 'advisor-test' }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
    const client = createAdvisorClient({ url: `http://127.0.0.1:${port}`, timeoutMs: 1000 })
    const result = await client.advice({ mode: 'gate', goal: '发布' })
    assert.equal(received.mode, 'gate')
    assert.equal(result.available, true)
    assert.equal(result.advice[0].score, 0.72)
    assert.equal(result.advice[0].source, 'advisor')
    assert.deepEqual(result.advice[0].missingEvidence, undefined)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
