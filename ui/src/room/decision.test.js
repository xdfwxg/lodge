import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatDecision } from './chat/decision.js'

test('chat awaiting decision shows the conclusion and the next actions', () => {
  const decision = buildChatDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'awaiting_decision', running: false, round: 1, turns: 4, turnLimit: 4 },
    messages: [{ kind: 'chat_conclusion', text: '结论：先做返工台账。' }],
  })
  assert.equal(decision.title, '讨论结束，等你确认结论')
  assert.match(decision.detail, /返工台账/)
  assert.equal(decision.primary.label, '确认结论')
  assert.equal(decision.extra.label, '用结论新建工作室')
  const complete = buildChatDecision({
    roomType: 'chat',
    state: 'complete',
    chat: { phase: 'accepted', accepted: true, running: false, round: 1, turns: 4, turnLimit: 4 },
    messages: [{ kind: 'chat_conclusion', text: '结论：先做返工台账。' }],
  })
  assert.equal(complete.title, '聊天已结束')
  assert.equal(complete.extra.label, '用结论新建工作室')

  const interrupted = buildChatDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'discussing', running: false, turns: 2, turnLimit: 4 },
    messages: [],
  })
  assert.equal(interrupted.title, '讨论中断，等你处理')
  assert.equal(interrupted.primary.action, 'chat-resume')
  assert.doesNotMatch(interrupted.detail, /\d+\/\d+/)
})

test('a free chat does not show speaking counts', () => {
  const running = buildChatDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'discussing', running: true, turns: 2, turnLimit: 4, speaker: 'worker' },
  })
  assert.equal(running.title, '讨论中')
  assert.doesNotMatch(running.title, /\d+/)
  assert.equal(running.key, 'chat-running')
  const waiting = buildChatDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'awaiting_decision', running: false, round: 1, turns: 4, turnLimit: 4 },
    messages: [{ kind: 'chat_conclusion', text: '结论：先做返工台账。' }],
  })
  assert.equal(waiting.key, 'chat-decision')
})
