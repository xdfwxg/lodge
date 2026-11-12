import assert from 'node:assert/strict'
import test from 'node:test'
import { createMessageProjector } from './live-projection.js'

const projector = createMessageProjector({
  store: { readRoom: () => ({ seatBots: { executor: 'bot-1' }, hiddenBaseMessages: [] }) },
})

test('base digests never become a seat chat message', () => {
  assert.equal(projector.toStored('room-1', { id: 'd1', kind: 'digest', role: 'bot', text: '[digest]' }), null)
})

test('base notices stay system lines, not fake chat', () => {
  const stored = projector.toStored('room-1', { id: 'n1', kind: 'notice', role: 'bot', text: 'Paused: no new work.' })
  assert.equal(stored.kind, 'system')
  assert.match(stored.text, /Paused/)
})

test('seat messages keep their seat author', () => {
  const stored = projector.toStored('room-1', { id: 'm1', kind: 'text', role: 'bot', authorRef: 'bot-1', text: '在' })
  assert.equal(stored.kind, 'chat')
  assert.equal(stored.authorId, 'executor')
})
