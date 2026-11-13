import assert from 'node:assert/strict'
import test from 'node:test'
import { createServiceTrust } from './service-trust.js'

const setup = room => {
  let current = structuredClone(room)
  const messages = []
  const store = {
    readMessages: () => [],
    updateRoom: (id, mutate) => {
      const next = structuredClone(current)
      const result = mutate(next)
      if (result === null) return null
      current = next
      return current
    },
    appendMessage: (id, message) => messages.push(message),
  }
  const trusted = createServiceTrust({ store, emit: () => {}, dispatchPayload: () => ({}) })
  return { trusted, messages, room: () => current }
}

test('trust can be lowered at any time and is audited', () => {
  const ctx = setup({ id: 'r1', trust: 'verify', stages: [] })
  const result = ctx.trusted.setTrust(ctx.room(), { level: 'observe', reason: '先只读' })
  assert.equal(result.ok, true)
  assert.equal(ctx.room().trust, 'observe')
  assert.match(ctx.messages.at(-1).text, /verify → observe/)
  assert.equal(ctx.room().trustReason, '先只读')
})

test('trust cannot be raised without evidence', () => {
  const ctx = setup({ id: 'r1', trust: 'observe', stages: [{ kind: 'deliverable', state: 'active', acceptance: 'true' }] })
  const result = ctx.trusted.setTrust(ctx.room(), { level: 'verify' })
  assert.equal(result.ok, false)
  assert.match(result.error, /已通过阶段/)
  assert.equal(ctx.room().trust, 'observe')
})
