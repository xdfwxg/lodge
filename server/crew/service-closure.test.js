import assert from 'node:assert/strict'
import test from 'node:test'
import { createServiceClosure } from './service-closure.js'

const setup = closure => {
  let current = {
    id: 'room-studio',
    kind: 'room',
    roomType: 'studio',
    state: 'active',
    closure,
    leadSeat: 'planner',
  }
  const messages = []
  const store = {
    updateRoom: (id, mutate) => {
      const next = structuredClone(current)
      if (mutate(next) === null) return null
      current = next
      return current
    },
    appendMessage: (id, message) => {
      const stored = { id: `m-${messages.length + 1}`, ...message }
      messages.push(stored)
      return stored
    },
  }
  const service = createServiceClosure({ store, emit: () => {}, dispatchPayload: () => null })
  return { service, room: () => current, messages }
}

test('Planner can reject a target before execution', () => {
  const ctx = setup('planned')
  const result = ctx.service.rejectPlan(ctx.room(), { reason: '目标不可行' })
  assert.equal(result.ok, true)
  assert.equal(ctx.room().closure, 'rejected')
  assert.equal(ctx.room().state, 'stopped')
  assert.equal(ctx.messages.at(-1).kind, 'plan_rejection')
})

test('Planner cannot terminate after execution starts', () => {
  const ctx = setup('executing')
  const result = ctx.service.rejectPlan(ctx.room(), { reason: '想停' })
  assert.equal(result.ok, false)
  assert.match(result.error, /planned|执行/)
})
