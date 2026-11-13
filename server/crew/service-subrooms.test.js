import assert from 'node:assert/strict'
import test from 'node:test'
import { createServiceSubrooms } from './service-subrooms.js'

test('a subroom is always created as a studio with the parent', async () => {
  const calls = []
  const service = createServiceSubrooms({
    createRoom: async (body, parent) => {
      calls.push({ body, parent })
      return { ok: true }
    },
  })
  const parent = { id: 'parent', roomType: 'studio', state: 'active', depth: 0 }
  const result = await service.create(parent, { goal: '子任务', roomType: 'chat' })
  assert.equal(result.ok, true)
  assert.equal(calls[0].body.roomType, 'studio')
  assert.equal(calls[0].parent, parent)
})

test('chat and depth-limited studios cannot create subrooms', async () => {
  const service = createServiceSubrooms({ createRoom: async () => ({ ok: true }) })
  const chat = await service.create({ roomType: 'chat', state: 'active', depth: 0 }, { goal: 'x' })
  assert.equal(chat.ok, false)
  const deep = await service.create({ roomType: 'studio', state: 'active', depth: 3 }, { goal: 'x' })
  assert.equal(deep.ok, false)
})
