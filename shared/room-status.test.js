import assert from 'node:assert/strict'
import test from 'node:test'
import { chatModeOf, chatStartedOf, chatStatusOf, idleDelivered, roomDeletableNow, roomStatusOf, roundOpen, roundStatusOf, stageStatusOf, stagesCompletedOf } from './room-status.js'

test('room lifecycle never reports a delivered round as a room state', () => {
  assert.equal(roomStatusOf({ state: 'idle' }), 'idle')
  assert.equal(roomStatusOf({ state: 'active', activeRoundId: 'round-1' }), 'active')
  assert.equal(roomStatusOf({ state: 'paused', activeRoundId: 'round-1' }), 'paused')
  assert.equal(roomStatusOf({ state: 'stopped' }), 'stopped')
  assert.equal(roomStatusOf({ state: 'idle', archivedAt: 1 }), 'archived')
})

test('a completed round is a round fact, not a room state', () => {
  const room = {
    state: 'idle',
    activeRoundId: null,
    workRound: { id: 'round-1', status: 'completed' },
  }
  assert.equal(roomStatusOf(room), 'idle')
  assert.equal(roundStatusOf(room), 'completed')
  assert.equal(roundOpen(room), false)
})

test('round summaries answer round facts', () => {
  const room = {
    state: 'idle',
    rounds: [
      { id: 'round-1', status: 'completed' },
      { id: 'round-2', status: 'stopped' },
    ],
  }
  assert.equal(roundStatusOf({ status: 'active' }), 'active')
  assert.equal(roundOpen({ status: 'planning' }), true)
  assert.equal(idleDelivered(room), false)
})

test('idleDelivered is the current state, not the last delivered round', () => {
  const activeNext = {
    state: 'active',
    activeRoundId: 'round-2',
    workRound: { id: 'round-2', status: 'active' },
    rounds: [{ id: 'round-1', status: 'completed' }],
  }
  assert.equal(idleDelivered(activeNext), false)
  assert.equal(idleDelivered({ state: 'idle', workRound: { id: 'round-1', status: 'completed' } }), true)
  assert.equal(idleDelivered({ state: 'idle', rounds: [{ id: 'round-1', status: 'completed' }, { id: 'round-2', status: 'stopped' }] }), false)
  assert.equal(idleDelivered({ state: 'active', activeRoundId: 'round-2' }), false)
})

test('stage status folds the stage and the room-level blockers into one word', () => {
  const stages = [{ state: 'active' }, { state: 'pending' }, { state: 'passed' }]
  assert.equal(stageStatusOf({ stages }, 0), 'active')
  assert.equal(stageStatusOf({ stages }, 1), 'pending')
  assert.equal(stageStatusOf({ stages }, 2), 'passed')
  assert.equal(stageStatusOf({ stages }, 9), null)
  assert.equal(stageStatusOf({ stages, mergeConflict: { stage: 0 } }, 0), 'blocked')
  assert.equal(stageStatusOf({ stages, blocked: { stage: 0 } }, 0), 'blocked')
  assert.equal(stageStatusOf({ stages, openQuestion: '要 A 还是 B？' }, 0), 'waiting')
  assert.equal(stageStatusOf({ stages, autoCheck: { stage: 0, status: 'limit-reached' } }, 0), 'waiting')
  assert.equal(stageStatusOf({ stages, lastPlannerDecision: { stage: 0, kind: 'human' } }, 0), 'waiting')
  assert.equal(stageStatusOf({ stages, lastPlannerDecision: { stage: 0, kind: 'rework' } }, 0), 'active')
})

test('chat mode is derived from the round phase, not stored twice', () => {
  assert.equal(chatModeOf({}), 'open')
  assert.equal(chatModeOf({ chat: { phase: 'concluded' } }), 'open')
  assert.equal(chatModeOf({ chat: { phase: 'discussing' } }), 'round')
  assert.equal(chatModeOf({ chat: { phase: 'summarizing' } }), 'round')
})

test('chat status folds phase, running flags and the first message into one word', () => {
  const said = [{ kind: 'chat', authorId: 'member' }]
  assert.equal(chatStatusOf({ state: 'paused', chat: { phase: 'discussing' } }), 'paused')
  assert.equal(chatStatusOf({ state: 'stopped', chat: { phase: 'discussing' } }), 'stopped')
  assert.equal(chatStatusOf({ chat: { phase: 'summarizing', running: true } }), 'summarizing')
  assert.equal(chatStatusOf({ chat: { phase: 'concluded' } }), 'concluded')
  assert.equal(chatStatusOf({ chat: { phase: 'discussing', hostThinking: true } }), 'thinking')
  assert.equal(chatStatusOf({ chat: { phase: 'discussing', running: true } }), 'running')
  assert.equal(chatStatusOf({ chat: { phase: 'discussing', running: false, interrupted: true } }), 'paused')
  assert.equal(chatStatusOf({ chat: { phase: 'discussing' }, messages: said }), 'discussing')
  assert.equal(chatStatusOf({ chat: { phase: 'discussing' }, messages: [] }), 'idle')
  assert.equal(chatStatusOf({ chat: { phase: 'discussing' }, messages: [{ kind: 'chat', authorId: 'lodge' }] }), 'idle')
})

test('chat started is one fact shared by the room view and the island', () => {
  assert.equal(chatStartedOf({ chat: { running: true } }), true)
  assert.equal(chatStartedOf({ chat: { hostThinking: true } }), true)
  assert.equal(chatStartedOf({ chat: { phase: 'summarizing' } }), true)
  assert.equal(chatStartedOf({ chat: { phase: 'concluded' } }), true)
  assert.equal(chatStartedOf({ chat: {}, messages: [{ kind: 'chat', authorId: 'member' }] }), true)
  assert.equal(chatStartedOf({ chat: {}, messages: [{ kind: 'chat', authorId: 'lodge' }] }), false)
  assert.equal(chatStartedOf({ chat: {}, messages: [] }), false)
})

test('all stages passed is one fact shared by the room shell, studio transcript and memory', () => {
  assert.equal(stagesCompletedOf({ stages: [{ state: 'passed' }, { state: 'passed' }] }), true)
  assert.equal(stagesCompletedOf({ stages: [{ state: 'passed' }, { state: 'active' }] }), false)
  assert.equal(stagesCompletedOf({ stages: [] }), false)
  assert.equal(stagesCompletedOf({}), false)
})

test('only a room that is actually running refuses direct deletion', () => {
  // 聊天室：聊完了就能删，轮次还开着不算在跑。
  assert.equal(roomDeletableNow({ roomType: 'chat', state: 'active', activeRoundId: 'r1', chat: { phase: 'concluded', running: false } }), true)
  assert.equal(roomDeletableNow({ roomType: 'chat', state: 'active', chat: { phase: 'discussing', running: true } }), false)
  // 工作室：这一轮开着就不能删；交付完或停住就能删。
  assert.equal(roomDeletableNow({ roomType: 'studio', state: 'active', workRound: { status: 'active' } }), false)
  assert.equal(roomDeletableNow({ roomType: 'studio', state: 'complete', workRound: { status: 'completed' } }), true)
  assert.equal(roomDeletableNow({ roomType: 'studio', state: 'stopped', workRound: { status: 'stopped' } }), true)
  // 归档过的房随时能删。
  assert.equal(roomDeletableNow({ archivedAt: 1, roomType: 'studio', workRound: { status: 'active' } }), true)
})
