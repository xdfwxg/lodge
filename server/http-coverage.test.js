import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHttpHandler } from './http.js'
import { ROOM_ACTIONS } from './route-table.js'

const start = async ({ roomRequest = null } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-http-'))
  mkdirSync(join(root, 'ui', 'dist'), { recursive: true })
  writeFileSync(join(root, 'ui', 'dist', 'index.html'), '<html>ok</html>')
  const actions = []
  const service = {
    state: async () => ({ rooms: [] }),
    health: async () => ({ ok: true, body: { ok: true } }),
    messagesSince: () => [],
    recommendRoster: async () => ({ ok: true, body: { roles: [] } }),
    createRoom: async body => ({ ok: true, body: { room: { id: 'room-1', goal: body.goal } } }),
    createSampleRoom: async () => ({ ok: true, body: { room: { id: 'sample' } } }),
    evidence: async () => ({ ok: true, body: { evidence: {} } }),
    memory: async () => ({ ok: true, body: { entries: [], canReview: true } }),
    memoryReview: async () => ({ ok: true, body: { entries: [], canReview: true } }),
    roomRequest: roomRequest ?? (async (roomId, action) => {
      actions.push(action)
      return { ok: true, body: { room: { id: roomId, action } } }
    }),
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
  return {
    base,
    actions,
    close: async () => {
      await new Promise(resolve => server.close(resolve))
      rmSync(root, { recursive: true, force: true })
    },
  }
}

const post = (base, path, body = {}) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

test('every successful HTTP route is counted only when it returns 2xx or 3xx', async () => {
  const ctx = await start()
  try {
    const covered = []
    const check = async (path, init) => {
      const response = await fetch(`${ctx.base}${path}`, init)
      if (response.status >= 200 && response.status < 400) covered.push(path)
      return response
    }
    assert.equal((await check('/api/state')).status, 200)
    assert.equal((await check('/api/health')).status, 200)
    assert.equal((await check('/api/rooms/sample', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 200)
    assert.equal((await check('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'x' }) })).status, 200)
    assert.equal((await check('/api/rooms/room-1/assignments')).status, 200)
    assert.equal((await check('/api/rooms/room-1/evidence/m1')).status, 200)
    assert.equal((await check('/api/rooms/room-1/memory')).status, 200)
    assert.equal((await check('/api/rooms/room-1/memory/room-1/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    })).status, 200)
    assert.equal((await check('/')).status, 200)
    for (const action of ROOM_ACTIONS) {
      const response = await check(`/api/rooms/room-1/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      assert.equal(response.status, 200, `${action} returned ${response.status}`)
    }
    assert.deepEqual(ctx.actions.sort(), [...ROOM_ACTIONS].sort())
    assert.equal(covered.length, 9 + ROOM_ACTIONS.length)
  } finally {
    await ctx.close()
  }
})

test('error kinds map to their own status codes and keep extra fields', async () => {
  const ctx = await start({
    roomRequest: async () => ({ ok: false, reason: 'forbidden', error: '不能这样做', fields: { hint: '先确认权限' } }),
  })
  try {
    const forbidden = await post(ctx.base, '/api/rooms/room-1/rework', {})
    assert.equal(forbidden.status, 403)
    assert.deepEqual(await forbidden.json(), { error: '不能这样做', hint: '先确认权限' })
    const upstream = await start({
      roomRequest: async () => ({ ok: false, reason: 'upstream', error: '基座没有回应' }),
    })
    try {
      assert.equal((await post(upstream.base, '/api/rooms/room-1/rework', {})).status, 502)
    } finally {
      await upstream.close()
    }
  } finally {
    await ctx.close()
  }
})

test('a validation answer is reached but not counted as covered', async () => {
  const ctx = await start({
    roomRequest: async () => ({ ok: false, reason: 'invalid', error: '缺少参数' }),
  })
  try {
    const response = await post(ctx.base, '/api/rooms/room-1/rework', {})
    assert.equal(response.status, 400)
    const missing = await fetch(`${ctx.base}/api/nope`)
    assert.equal(missing.status, 404)
  } finally {
    await ctx.close()
  }
})
