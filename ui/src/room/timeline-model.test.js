import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTimeline, dedupeChatStreams, isProcessMessage } from './timeline-model.js'

const message = (id, kind, over = {}) => ({ id, kind, seq: 1, text: '', ...over })

test('process messages leave the main timeline but keep their order in one log', () => {
  const messages = [
    message('c1', 'chat', { authorId: 'you', text: '开始' }),
    message('d1', 'dispatch'),
    message('a1', 'activity'),
    message('t1', 'evidence', { meta: { kind: 'turn' } }),
    message('s1', 'stage_conclusion'),
    message('x1', 'conclusion'),
  ]
  const timeline = buildTimeline(messages)
  assert.deepEqual(timeline.visible.map(item => item.id), ['c1', 'd1', 's1'])
  assert.deepEqual(timeline.process.map(item => item.id), ['a1', 't1', 'x1'])
  assert.equal(isProcessMessage(messages[1]), false)
  assert.equal(isProcessMessage(messages[2]), true)
  assert.equal(isProcessMessage(messages[3]), true)
})

test('a human rework marker yields to its human-context record', () => {
  const messages = [
    message('r1', 'rework', { authorId: 'you', text: '补一句上下文', meta: { stage: 1, source: 'rewind' } }),
    message('h1', 'human-context', { authorId: 'you', text: '补一句上下文', meta: { stage: 1, source: 'rewind' } }),
  ]
  const timeline = buildTimeline(messages)
  assert.deepEqual(timeline.visible.map(item => item.id), ['h1'])
  assert.ok(timeline.process.some(item => item.id === 'r1'))
})

test('an old human rework without a context record stays visible', () => {
  const messages = [
    message('r1', 'rework', { authorId: 'you', text: '旧的重做意见', meta: { stage: 1, source: 'human' } }),
  ]
  assert.deepEqual(buildTimeline(messages).visible.map(item => item.id), ['r1'])
})

test('a verdict consumes its evidence and points the result card at it', () => {
  const messages = [
    message('e1', 'evidence', { seq: 2, meta: { kind: 'command', stage: 1, command: 'npm test', exit: 0 } }),
    message('v1', 'verdict', { seq: 3, text: 'PASS', meta: { stage: 1, pass: true, evidenceId: 'e1' } }),
  ]
  const timeline = buildTimeline(messages)
  assert.deepEqual(timeline.visible.map(item => item.id), ['v1'])
  assert.equal(timeline.evidenceFor.get('v1').id, 'e1')
})

test('an unlinked verdict still consumes the latest evidence of its stage', () => {
  const messages = [
    message('old', 'evidence', { seq: 1, meta: { kind: 'command', stage: 1 } }),
    message('e1', 'evidence', { seq: 4, meta: { kind: 'command', stage: 1 } }),
    message('v1', 'verdict', { seq: 5, text: 'PASS', meta: { stage: 1, pass: true } }),
  ]
  const timeline = buildTimeline(messages)
  assert.deepEqual(timeline.visible.map(item => item.id), ['old', 'v1'])
  assert.equal(timeline.evidenceFor.get('v1').id, 'e1')
})

test('empty base chat never reaches the main timeline', () => {
  const messages = [
    message('e1', 'chat', { authorId: 'executor', text: '' }),
    message('e2', 'chat', { authorId: 'executor', text: '  ' }),
    message('e3', 'chat', { authorId: 'executor', text: '在' }),
  ]
  assert.deepEqual(buildTimeline(messages).visible.map(item => item.id), ['e3'])
})

test('a stream placeholder yields to the final copy of the same speech', () => {
  const messages = [
    message('stream:r:worker', 'chat', { authorId: 'worker', ts: 5, text: '甲' }),
    message('b1', 'chat', { authorId: 'worker', ts: 5, text: '甲' }),
    message('stream:r:worker-2', 'chat', { authorId: 'worker-2', ts: 6, text: '乙' }),
  ]
  assert.deepEqual(dedupeChatStreams(messages).map(item => item.id), ['b1', 'stream:r:worker-2'])
  assert.deepEqual(buildTimeline(messages).visible.map(item => item.id), ['b1', 'stream:r:worker-2'])
})

test('a truncated second copy of the same speech keeps only the complete one', () => {
  const full = '三步切好了：源图正好 900×300，按宽度均分直接得到三张 300×300；@验收员 请复核第二阶段。'
  const messages = [
    message('c1', 'chat', { authorId: 'executor', ts: 10, text: full }),
    message('c2', 'chat', { authorId: 'executor', ts: 11, text: full.slice(0, 40) }),
    message('c3', 'chat', { authorId: 'executor', ts: 12, text: '验收员那边还没回。' }),
  ]
  const timeline = buildTimeline(messages)
  assert.deepEqual(timeline.visible.map(item => item.id), ['c1', 'c3'])
  assert.equal(timeline.visible[0].text, full)
})

test('consecutive user messages stay at the end of the timeline', () => {
  const messages = [
    message('b1', 'chat', { authorId: 'planner', text: '收到' }),
    message('u1', 'chat', { authorId: 'you', text: '继续' }),
    message('u2', 'chat', { authorId: 'you', text: '补充一句' }),
  ]
  assert.equal(buildTimeline(messages).trailingStart, 1)
})
