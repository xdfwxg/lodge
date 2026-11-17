import assert from 'node:assert/strict'
import test from 'node:test'
import { baselineSeen, decisionOf, milestoneOf } from './signal.js'

const room = over => ({
  id: 'room-1',
  roomType: 'studio',
  state: 'active',
  stages: [
    { title: '目标对齐', state: 'passed' },
    { title: '写欢迎语', state: 'active' },
    { title: '验收与结论', state: 'pending' },
  ],
  messages: [],
  delivery: null,
  ...over,
})

const message = (id, kind, meta = {}, text = '') => ({ id, kind, meta, text, seq: Number(id) || 0 })

test('a human decision becomes a sticky signal that opens the panel', () => {
  const event = decisionOf(room({ needsYou: { kind: 'signoff', stage: 1, label: '待签字' } }))
  assert.equal(event.key, 'decision:signoff:1')
  assert.equal(event.kind, 'decision')
  assert.equal(event.tone, 'waiting')
  assert.equal(event.title, '第 2 步「写欢迎语」通过了')
  assert.equal(event.action, 'open')
  assert.match(event.detail, /待签字/)
})

test('more waiting items put a count on the same signal line', () => {
  const event = decisionOf(room({
    needsYou: { kind: 'signoff', stage: 1, label: '待签字' },
    attention: [
      { kind: 'signoff', stage: 1, label: '待签字' },
      { kind: 'decision', roomId: 'child-1', roomName: '写欢迎语', stage: 0, label: '待确认' },
    ],
  }))
  assert.match(event.title, /还有 1 件$/)
})

test('a subroom decision says whose it is', () => {
  const event = decisionOf(room({
    needsYou: { kind: 'decision', roomId: 'child-1', roomName: '写欢迎语', stage: 0, label: '待确认' },
    attention: [{ kind: 'decision', roomId: 'child-1', roomName: '写欢迎语', stage: 0, label: '待确认' }],
  }))
  assert.match(event.title, /写欢迎语/)
  assert.doesNotMatch(event.title, /还有/)
})

test('a stopped automatic check reads as one plain sentence', () => {
  const event = decisionOf(room({
    needsYou: { kind: 'auto-check', stage: 1, label: '这一步没做成，需要你决定' },
  }))
  assert.equal(event.kind, 'decision')
  assert.equal(event.tone, 'paused')
  assert.equal(event.title, '这一步没做成，需要你决定')
})

test('ambient states do not become decisions', () => {
  assert.equal(decisionOf(room({ needsYou: { kind: 'review', stage: 1, label: '验收员在看' } })), null)
  assert.equal(decisionOf(room({ needsYou: { kind: 'idle', stage: 1, label: '可继续' } })), null)
})

test('the first snapshot only builds a baseline', () => {
  const first = room({ messages: [message('1', 'verdict', { pass: false, stage: 1 }, 'REJECT')] })
  const { event, seen } = milestoneOf(null, first, new Set())
  assert.equal(event, null)
  assert.ok(seen.has('msg:1'))
  assert.ok(seen.has('stage:0:passed'))
})

test('a new stage conclusion peeks once and never replays', () => {
  const previous = room({ messages: [message('1', 'evidence', { kind: 'command', exit: 0 })] })
  const next = room({
    messages: [
      ...previous.messages,
      message('2', 'stage_conclusion', { stage: 1, title: '写欢迎语', next: '验收与结论' }),
    ],
  })
  const { event, seen } = milestoneOf(previous, next, baselineSeen(previous))
  assert.equal(event.kind, 'milestone')
  assert.equal(event.title, '第 2 步「写欢迎语」通过')
  assert.equal(event.detail, '下一步：验收与结论')
  assert.equal(milestoneOf(next, next, seen).event, null)
})

test('a failure outranks a passing stage in the same snapshot', () => {
  const previous = room()
  const next = room({
    messages: [
      message('1', 'stage_conclusion', { stage: 1, title: '写欢迎语', next: null }),
      message('2', 'verdict', { pass: false, stage: 1 }, 'REJECT：没有写进文件'),
    ],
  })
  const { event } = milestoneOf(previous, next, baselineSeen(previous))
  assert.equal(event.title, '第 2 步「写欢迎语」退回')
  assert.equal(event.tone, 'paused')
})

test('a conclusion leaves completion to the result card', () => {
  const previous = room()
  const next = room({
    messages: [
      message('1', 'stage_conclusion', { stage: 1, title: '写欢迎语', next: null }),
      message('2', 'conclusion', { stages: 3, commands: [] }, '已交付：欢迎语落地'),
    ],
  })
  const { event } = milestoneOf(previous, next, baselineSeen(previous))
  assert.notEqual(event?.title, '已完成')
})

test('a new delivery leaves the announcement to the result card', () => {
  const previous = room()
  const next = room({ delivery: { commit: null } })
  const { event } = milestoneOf(previous, next, baselineSeen(previous))
  assert.equal(event, null)
})

test('a passed stage is a fallback when no message arrived', () => {
  const previous = room()
  const next = room({
    stages: [
      { title: '目标对齐', state: 'passed' },
      { title: '写欢迎语', state: 'passed' },
      { title: '验收与结论', state: 'pending' },
    ],
  })
  const { event } = milestoneOf(previous, next, baselineSeen(previous))
  assert.equal(event.title, '第 2 步「写欢迎语」通过')
  assert.equal(event.detail, '下一步：验收与结论')
})

test('reconnect and streaming patches do not replay events', () => {
  const previous = room({ messages: [message('1', 'verdict', { pass: true, stage: 1 }, 'PASS')] })
  const seen = baselineSeen(previous)
  const patched = room({ messages: [{ ...previous.messages[0], text: 'PASS，补一句说明' }] })
  assert.equal(milestoneOf(previous, patched, seen).event, null)
})

test('a child result and a successful check each have their own signal', () => {
  const previous = room()
  const child = room({
    messages: [message('1', 'child_result', { childName: '发布检查' }, '子房间交回三条结论')],
  })
  assert.equal(milestoneOf(previous, child, baselineSeen(previous)).event.title, '子房间「发布检查」交回结果')

  const checked = room({
    messages: [message('2', 'evidence', { kind: 'command', exit: 0, command: 'npm test' })],
  })
  const { event } = milestoneOf(previous, checked, baselineSeen(previous))
  assert.equal(event.title, '检查通过')
  assert.equal(event.detail, 'npm test')
})

test('a failed command waits for the rework decision instead of peeking twice', () => {
  const previous = room()
  const next = room({
    messages: [message('1', 'evidence', { kind: 'command', exit: 1, command: 'npm test' })],
  })
  assert.equal(milestoneOf(previous, next, baselineSeen(previous)).event, null)
})
