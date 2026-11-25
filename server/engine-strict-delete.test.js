import assert from 'node:assert/strict'
import test from 'node:test'
import { createEngine } from './engine.js'

const engineWith = deleteBot => createEngine({
  client: { deleteBot, deleteGroup: async () => {} },
})

test('a strict delete treats a missing bot as already gone', async () => {
  const engine = engineWith(async () => { throw new Error('base 404 /api/bots/a: missing') })
  await assert.doesNotReject(() => engine.deleteMemberBot('a', { strict: true }))
})

test('a strict delete surfaces a base failure; the lazy one still swallows it', async () => {
  const engine = engineWith(async () => { throw new Error('base 500 /api/bots/a: boom') })
  await engine.deleteMemberBot('a')
  await assert.rejects(() => engine.deleteMemberBot('a', { strict: true }), /base 500/)
})
