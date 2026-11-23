import assert from 'node:assert/strict'
import test from 'node:test'
import { alreadyMentioned } from './relay-words.js'

const room = {
  members: [
    { id: 'lead', name: '规划师' },
    { id: 'worker', name: '甲' },
    { id: 'worker-2', name: '乙' },
  ],
}
const chat = (authorId, text) => ({ kind: 'chat', authorId, text })

test('a relay already named by its sender is not repeated', () => {
  assert.equal(alreadyMentioned({ room, messages: [chat('lead', '计划写好了\n@甲 这版你来做')], from: 'lead', targets: ['worker'] }), true)
  assert.equal(alreadyMentioned({ room, messages: [chat('lead', '@甲 和 @乙 一起做')], from: 'lead', targets: ['worker', 'worker-2'] }), true)
})

test('a missing target, another author or no message still needs the system line', () => {
  assert.equal(alreadyMentioned({ room, messages: [chat('lead', '@甲 做')], from: 'lead', targets: ['worker', 'worker-2'] }), false)
  assert.equal(alreadyMentioned({ room, messages: [chat('worker', '@甲 做')], from: 'lead', targets: ['worker'] }), false)
  assert.equal(alreadyMentioned({ room, messages: [], from: 'lead', targets: ['worker'] }), false)
  assert.equal(alreadyMentioned({ room, messages: [chat('lead', '@甲 做')], from: 'lead', targets: [] }), false)
})
