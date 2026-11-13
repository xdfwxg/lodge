import assert from 'node:assert/strict'
import test from 'node:test'
import { dispatchSummaryOf, isDispatchHandoff } from './handoff.js'

const room = { roomType: 'studio', leadSeat: 'lead' }
const message = over => ({
  kind: 'chat',
  authorId: 'lead',
  text: '@执行官 阶段 2「修复 pad」。工作目录：/tmp/room。验收命令：`node --test test/pad.test.js`。完成后停在当前目录，不要提交。',
  ...over,
})

test('a long planner handoff becomes a summary, not a chat bubble', () => {
  assert.equal(isDispatchHandoff(room, message()), true)
  assert.deepEqual(dispatchSummaryOf(message()), {
    mention: '执行官',
    acceptance: 'node --test test/pad.test.js',
    stage: '2',
  })
})

test('bold labels do not leak into the acceptance command', () => {
  const bold = message({
    text: '@验收员 阶段 2 已交付，请你盲审。\n\n**工作目录**：`/tmp/room`\n\n**验收命令**（唯一判定依据）：`node --test test/pad.test.js`。',
  })
  assert.equal(isDispatchHandoff(room, bold), true)
  assert.deepEqual(dispatchSummaryOf(bold), {
    mention: '验收员',
    acceptance: 'node --test test/pad.test.js',
    stage: '2',
  })
})

test('short lead chat and chat-room messages stay normal chat', () => {
  assert.equal(isDispatchHandoff(room, message({ text: '@执行官 辛苦，继续。' })), false)
  assert.equal(isDispatchHandoff({ ...room, roomType: 'chat' }, message()), false)
  assert.equal(isDispatchHandoff(room, message({ authorId: 'worker' })), false)
})
