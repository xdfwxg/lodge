import assert from 'node:assert/strict'
import test from 'node:test'
import { attemptScopeOf, cardActionsOf, cardStateOf, reworkFloor, scopeIsValid } from './attempt.js'

const room = { stages: [{ state: 'passed' }, { state: 'active' }] }
const card = (scope, requestId = 'req-1') => ({
  kind: 'question',
  meta: { card: { requestId, scope } },
})

test('the rework floor only counts rework messages for the stage', () => {
  const messages = [
    { kind: 'rework', seq: 3, meta: { stage: 1 } },
    { kind: 'rework', seq: 5, meta: { stage: 0 } },
    { kind: 'rework', seq: 8, meta: { stage: 1 } },
  ]
  assert.equal(reworkFloor(messages, 1), 8)
  assert.equal(reworkFloor(messages, 0), 5)
  assert.equal(reworkFloor(messages, 2), -1)
})

test('the attempt scope is the active stage plus its rework floor', () => {
  const messages = [{ kind: 'rework', seq: 4, meta: { stage: 1 } }]
  assert.deepEqual(attemptScopeOf({ room, messages }), { stage: 1, floor: 4, assignment: null })
  assert.deepEqual(attemptScopeOf({ room: { stages: [] }, messages }), { stage: null, floor: -1, assignment: null })
})

test('the scope also binds to the member assignment', () => {
  const assigned = {
    stages: [
      { state: 'passed' },
      {
        state: 'active',
        tasks: [
          { id: 'as-a', assignmentId: 'as-a', owner: 'worker' },
          { id: 'as-b', assignmentId: 'as-b', owner: 'worker-2' },
        ],
      },
    ],
  }
  const messages = []
  assert.equal(attemptScopeOf({ room: assigned, messages, memberId: 'worker' }).assignment, 'as-a')
  assert.equal(attemptScopeOf({ room: assigned, messages, memberId: 'worker-2' }).assignment, 'as-b')
  assert.equal(attemptScopeOf({ room: assigned, messages, memberId: 'lead' }).assignment, null)
  const scope = { stage: 1, floor: -1, assignment: 'as-a' }
  assert.equal(scopeIsValid(scope, { room: assigned, messages }), true)
  const replaced = {
    ...assigned,
    stages: [assigned.stages[0], { state: 'active', tasks: [{ id: 'as-a2', assignmentId: 'as-a2', owner: 'worker' }] }],
  }
  assert.equal(scopeIsValid(scope, { room: replaced, messages }), false)
})

test('a card survives until its stage advances or its floor moves', () => {
  const messages = [{ kind: 'rework', seq: 4, meta: { stage: 1 } }]
  const scope = { stage: 1, floor: 4 }
  assert.equal(scopeIsValid(scope, { room, messages }), true)
  assert.equal(scopeIsValid(scope, { room: { stages: [{ state: 'active' }] }, messages: [] }), false)
  assert.equal(scopeIsValid(scope, { room, messages: [...messages, { kind: 'rework', seq: 9, meta: { stage: 1 } }] }), false)
  assert.equal(scopeIsValid(null, { room, messages }), true)
  assert.equal(scopeIsValid({ stage: null, floor: -1 }, { room: { stages: [] }, messages }), true)
})

test('a card is open, answered or stale from the room facts', () => {
  const messages = [{ kind: 'rework', seq: 4, meta: { stage: 1 } }]
  const scope = { stage: 1, floor: 4 }
  assert.equal(cardStateOf(room, card(scope), messages), 'open')
  assert.equal(cardStateOf(room, card(scope), [...messages, { kind: 'system', meta: { kind: 'card-answered', requestId: 'req-1' } }]), 'answered')
  assert.equal(cardStateOf(room, card(scope), [...messages, { kind: 'rework', seq: 9, meta: { stage: 1 } }]), 'stale')
  assert.equal(cardStateOf({ ...room, cardAnswers: ['req-1'] }, card(scope), messages), 'answered')
})

test('cards only expose actions for their current state', () => {
  assert.deepEqual(cardActionsOf({ kind: 'question', state: 'open' }), ['answer'])
  assert.deepEqual(cardActionsOf({ kind: 'question', state: 'stale' }), [])
  assert.deepEqual(cardActionsOf({ kind: 'question', state: 'answered' }), [])
  assert.deepEqual(cardActionsOf({ kind: 'approval', state: 'pending' }), ['allow', 'deny'])
  assert.deepEqual(cardActionsOf({ kind: 'approval', state: 'expired' }), [])
})
