import assert from 'node:assert/strict'
import test from 'node:test'
import { listRoomTemplates } from './room-templates.js'

test('templates point at the two public room engines', () => {
  const templates = listRoomTemplates()
  assert.deepEqual(templates.map(template => template.id), ['chat-roundtable', 'studio-delivery', 'studio-review'])
  assert.equal(templates.find(template => template.id === 'chat-roundtable').roomType, 'chat')
  assert.equal(templates.find(template => template.id === 'studio-delivery').roomType, 'studio')
  assert.ok(templates.filter(template => template.roomType === 'studio').every(template => (
    template.seats.some(seat => seat.role === 'verifier')
  )))
})
