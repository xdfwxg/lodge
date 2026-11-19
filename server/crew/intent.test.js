import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyIntent, parseIntent } from './intent.js'

test('the front desk reads a room decision from a fenced or plain reply', () => {
  assert.deepEqual(parseIntent('```json\n{"room":"studio","why":"要交一份机票清单"}\n```'), {
    room: 'studio',
    why: '要交一份机票清单',
  })
  assert.deepEqual(parseIntent('{"room":"chat","why":"还在拿主意"}'), { room: 'chat', why: '还在拿主意' })
  assert.equal(parseIntent('我认为应该开工作室'), null)
  assert.equal(parseIntent('{"room":"meeting"}'), null)
})

test('when the front desk cannot judge, work still starts', async () => {
  const result = await classifyIntent({
    probe: { available: () => false },
    body: { goal: '查 1 月曼谷到太原的低价机票' },
    workspace: { root: () => '/tmp' },
  })
  assert.equal(result.ok, true)
  assert.equal(result.body.room, 'studio')
  assert.equal(result.body.fallback, true)
})
