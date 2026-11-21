import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ASSIGNMENT_STATUS,
  ASSIGNMENT_TERMINAL,
  ASSIGNMENT_TRANSITIONS,
  CHAT_PHASE,
  CHAT_TRANSITIONS,
  ROOM_STATUS,
  ROUND_STATUS,
  ROUND_TRANSITIONS,
  STAGE_STATUS,
  STATE_GROUPS,
} from './states.js'
import { chatStatusOf, roomStatusOf, roundStatusOf, stageStatusOf } from './room-status.js'

const values = group => Object.values(group)

test('every state group is frozen, unique and enumerable', () => {
  for (const [name, group] of Object.entries(STATE_GROUPS)) {
    assert.ok(Object.isFrozen(group), name)
    assert.ok(values(group).length > 0, name)
    assert.equal(new Set(values(group)).size, values(group).length, name)
  }
})

test('round transitions only reference known states', () => {
  for (const [from, row] of Object.entries(ROUND_TRANSITIONS)) {
    assert.ok(values(ROUND_STATUS).includes(from), from)
    for (const to of Object.values(row)) assert.ok(values(ROUND_STATUS).includes(to), to)
  }
})

test('assignment transitions only reference known states', () => {
  for (const [from, row] of Object.entries(ASSIGNMENT_TRANSITIONS)) {
    assert.ok(values(ASSIGNMENT_STATUS).includes(from), from)
    for (const to of row) assert.ok(values(ASSIGNMENT_STATUS).includes(to), to)
  }
  for (const status of ASSIGNMENT_TERMINAL) {
    assert.ok(values(ASSIGNMENT_STATUS).includes(status), status)
    // 终态只能停在终态里（rejected 可以再标成 failed），不能回到进行中。
    for (const to of ASSIGNMENT_TRANSITIONS[status] ?? []) {
      assert.ok(ASSIGNMENT_TERMINAL.has(to), `${status} -> ${to}`)
    }
  }
})

test('chat transitions only reference known phases', () => {
  for (const [from, row] of Object.entries(CHAT_TRANSITIONS)) {
    assert.ok(values(CHAT_PHASE).includes(from), from)
    for (const to of Object.values(row)) assert.ok(values(CHAT_PHASE).includes(to), to)
  }
})

test('read models only return catalog values', () => {
  assert.ok(values(ROOM_STATUS).includes(roomStatusOf({ state: 'idle' })))
  assert.ok(values(ROOM_STATUS).includes(roomStatusOf({ state: 'active', activeRoundId: 'r1' })))
  assert.ok(values(ROUND_STATUS).includes(roundStatusOf({ workRound: { status: 'active' } })))
  const stageRoom = { stages: [{ state: 'active' }, { state: 'pending' }, { state: 'passed' }] }
  for (const index of [0, 1, 2]) {
    assert.ok(values(STAGE_STATUS).includes(stageStatusOf(stageRoom, index)))
  }
  assert.ok(values(STAGE_STATUS).includes(stageStatusOf({ ...stageRoom, mergeConflict: { stage: 0 } }, 0)))
  assert.ok(values(STAGE_STATUS).includes(stageStatusOf({ ...stageRoom, openQuestion: '选哪个？' }, 0)))
  for (const chat of [
    { phase: 'discussing' },
    { phase: 'summarizing', running: true },
    { phase: 'concluded' },
  ]) {
    assert.ok(values(STATE_GROUPS.chatStatus).includes(chatStatusOf({ chat })))
  }
})
