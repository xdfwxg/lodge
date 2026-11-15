import assert from 'node:assert/strict'
import test from 'node:test'
import { presentRoom } from './presentation.js'

test('room events and state share one projected status and independence label', () => {
  const room = {
    id: 'room-1',
    state: 'active',
    busy: false,
    verifiers: [],
    openQuestion: null,
    independence: 'human',
    stages: [{ title: 'docs', kind: 'decision', state: 'active' }],
  }
  const presented = presentRoom(room, [])
  assert.deepEqual(presented.needsYou, { kind: 'decision', stage: 0, label: '待确认' })
  assert.equal(presented.independenceLabel, '你签字验收')
  assert.deepEqual(presented.capabilities, { dispatch: false })
  assert.equal(room.needsYou, undefined, 'projection does not mutate the stored room')
})
