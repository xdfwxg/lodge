import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHttpHandler, fail } from './http.js'

const fakeResponse = ({ headersSent = false, writableEnded = false } = {}) => {
  const calls = []
  return {
    calls,
    headersSent,
    writableEnded,
    writeHead: (...args) => calls.push(['writeHead', ...args]),
    end: (...args) => calls.push(['end', ...args]),
    destroy: (...args) => calls.push(['destroy', ...args]),
  }
}

test('a failure after headers went out closes that connection instead of writing a second head', () => {
  const res = fakeResponse({ headersSent: true })
  fail(res, new Error('boom'))
  assert.deepEqual(res.calls, [['destroy']])
})

test('a failure before headers still answers as JSON', () => {
  const res = fakeResponse()
  fail(res, new Error('请求体不是 JSON'))
  assert.equal(res.calls[0][0], 'writeHead')
  assert.equal(res.calls[1][0], 'end')
})

test('an events request that fails mid-stream does not take the server down', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-http-failure-'))
  mkdirSync(join(root, 'ui', 'dist'), { recursive: true })
  writeFileSync(join(root, 'ui', 'dist', 'index.html'), '<html>ok</html>')
  const service = {
    health: async () => ({ ok: true, body: { ok: true } }),
    messagesSince: () => { throw new Error('store 读坏了') },
    state: async () => ({ rooms: [] }),
  }
  const handler = createHttpHandler({
    root,
    service,
    store: { readAssignments: () => [] },
    clients: new Set(),
    send: () => {},
    chooseDirectory: async () => '',
    openPath: async () => {},
  })
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const events = await fetch(`${base}/api/events`).then(
      response => response.text().then(() => response.status),
      () => 'closed',
    )
    assert.ok(events === 'closed' || events === 200)
    const health = await fetch(`${base}/api/health`)
    assert.equal(health.status, 200)
  } finally {
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})
