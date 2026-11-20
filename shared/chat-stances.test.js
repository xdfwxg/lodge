import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_STANCES, stanceOf, stancePrompt } from './chat-stances.js'
import { CHAT_VOICE } from './chat-voice.js'

test('chat stances give each speaker one job', () => {
  assert.match(stancePrompt('proposer'), /具体方案/)
  assert.match(stancePrompt('critic'), /漏洞/)
  assert.match(stancePrompt('synthesizer'), /可决定的选项/)
  assert.equal(stanceOf('unknown'), '')
  assert.equal(stancePrompt('unknown'), '')
  assert.equal(Object.keys(CHAT_STANCES).length, 3)
})

test('chat voice keeps judgement first and citations grounded', () => {
  assert.match(CHAT_VOICE, /先给判断/)
  assert.match(CHAT_VOICE, /联网只读/)
  assert.match(CHAT_VOICE, /200 字/)
})
