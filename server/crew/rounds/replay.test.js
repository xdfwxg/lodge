import assert from 'node:assert/strict'
import test from 'node:test'
import { diffReplay, replayRound } from './replay.js'

const event = (seq, type, payload = {}) => ({ seq, type, payload, at: seq })

const events = () => [
  event(1, 'round.started', {
    roundId: 'round-1',
    ordinal: 1,
    stages: [
      { title: '实现', kind: 'deliverable' },
      { title: '回归', kind: 'deliverable' },
      { title: '验收与结论', kind: 'decision' },
    ],
  }),
  event(2, 'stage.dispatch', { stage: 0 }),
  event(3, 'assignment.created', { assignmentId: 'a-1', stage: 0, to: 'worker', reason: 'dispatch' }),
  event(4, 'assignment.sent', { assignmentId: 'a-1', stage: 0, memberId: 'worker' }),
  event(5, 'assignment.reported', { assignmentId: 'a-1', stage: 0, memberId: 'worker' }),
  event(6, 'stage.passed', { stage: 0 }),
  event(7, 'stage.dispatch', { stage: 1 }),
  event(8, 'round.completed', { roundId: 'round-1' }),
]

test('replay rebuilds stage and assignment state from events', () => {
  const replay = replayRound(events(), 'round-1')
  assert.equal(replay.roundStatus, 'completed')
  assert.deepEqual(replay.stages.map(stage => stage.state), ['passed', 'active', 'pending'])
  assert.equal(replay.stages[0].title, '实现')
  assert.deepEqual(replay.assignments, [{
    id: 'a-1',
    stage: 0,
    memberId: 'worker',
    status: 'reported',
    reason: 'dispatch',
  }])
  assert.deepEqual(replay.warnings, [])
})

test('a rewind moves the target back to active and later stages back to pending', () => {
  const replay = replayRound([
    ...events(),
    event(9, 'stage.rewind', { stage: 0 }),
  ], 'round-1')
  assert.deepEqual(replay.stages.map(stage => stage.state), ['active', 'pending', 'pending'])
})

test('replay stops at the next round', () => {
  const replay = replayRound([
    ...events(),
    event(9, 'round.started', { roundId: 'round-2', stages: [{ title: '下一轮' }] }),
    event(10, 'stage.dispatch', { stage: 0 }),
  ], 'round-1')
  assert.equal(replay.roundStatus, 'completed')
  assert.deepEqual(replay.stages.map(stage => stage.title), ['实现', '回归', '验收与结论'])
})

test('replay reports missing history instead of inventing it', () => {
  const replay = replayRound([event(1, 'room.created')], 'round-1')
  assert.equal(replay.roundStatus, null)
  assert.deepEqual(replay.stages, [])
  assert.match(replay.warnings[0], /round.started/)
})

test('diff reports stage and assignment drift', () => {
  const replay = replayRound(events(), 'round-1')
  const round = {
    status: 'active',
    stages: [{ state: 'passed' }, { state: 'pending' }, { state: 'pending' }],
  }
  const diffs = diffReplay(replay, {
    round,
    assignments: [{ id: 'a-1', status: 'sent' }],
  })
  assert.deepEqual(diffs.map(diff => diff.kind).sort(), ['assignment-status', 'round-status', 'stage-state'])
  assert.deepEqual(diffReplay(replay, { round, assignments: [{ id: 'a-1', status: 'reported' }] })
    .map(diff => diff.kind).sort(), ['round-status', 'stage-state'])
})
