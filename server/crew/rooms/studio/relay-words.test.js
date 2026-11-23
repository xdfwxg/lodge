import assert from 'node:assert/strict'
import test from 'node:test'
import { missingMentionsOf } from './relay-words.js'

const room = {
  members: [
    { id: 'lead', name: '规划师' },
    { id: 'worker', name: '甲' },
    { id: 'worker-2', name: '乙' },
  ],
}
const chat = (authorId, text) => ({ kind: 'chat', authorId, text })

test('nobody is missing when the sender named every target', () => {
  assert.deepEqual(missingMentionsOf({ room, messages: [chat('lead', '计划写好了\n@甲 这版你来做')], from: 'lead', targets: ['worker'] }), [])
  assert.deepEqual(missingMentionsOf({ room, messages: [chat('lead', '@甲 和 @乙 一起做')], from: 'lead', targets: ['worker', 'worker-2'] }), [])
})

test('a partial mention lists only the missing target', () => {
  assert.deepEqual(
    missingMentionsOf({ room, messages: [chat('lead', '@甲 先做前端')], from: 'lead', targets: ['worker', 'worker-2'] }),
    ['worker-2'],
  )
  assert.deepEqual(
    missingMentionsOf({ room, messages: [chat('lead', '计划如下\n@乙 先做后端')], from: 'lead', targets: ['worker', 'worker-2'] }),
    ['worker'],
  )
})

test('a prefix of a longer name is not that person', () => {
  assert.deepEqual(
    missingMentionsOf({ room, messages: [chat('lead', '@甲同学 做')], from: 'lead', targets: ['worker'] }),
    ['worker'],
  )
})

test('another author, no message or no targets still leaves everyone missing', () => {
  assert.deepEqual(missingMentionsOf({ room, messages: [chat('worker', '@甲 做')], from: 'lead', targets: ['worker'] }), ['worker'])
  assert.deepEqual(missingMentionsOf({ room, messages: [], from: 'lead', targets: ['worker'] }), ['worker'])
  assert.deepEqual(missingMentionsOf({ room, messages: [chat('lead', '@甲 做')], from: 'lead', targets: [] }), [])
})
