import assert from 'node:assert/strict'
import test from 'node:test'
import { dispatchSummaryOf, isDispatchHandoff } from './handoff.js'

const room = { roomType: 'studio', leadSeat: 'lead' }
const message = over => ({
  kind: 'chat',
  authorId: 'lead',
  text: '@执行者 阶段 2「修复 pad」。工作目录：/tmp/room。验收命令：`node --test test/pad.test.js`。完成后停在当前目录，不要提交。',
  ...over,
})

test('a long planner handoff becomes a summary, not a chat bubble', () => {
  assert.equal(isDispatchHandoff(room, message()), true)
  assert.deepEqual(dispatchSummaryOf(message()), {
    mention: '执行者',
    acceptance: 'node --test test/pad.test.js',
    stage: '2',
  })
})

test('short lead chat and chat-room messages stay normal chat', () => {
  assert.equal(isDispatchHandoff(room, message({ text: '@执行者 辛苦，继续。' })), false)
  assert.equal(isDispatchHandoff({ ...room, roomType: 'chat' }, message()), false)
  assert.equal(isDispatchHandoff(room, message({ authorId: 'worker' })), false)
})
