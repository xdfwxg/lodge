import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatDecision } from './chat/decision.js'

test('a concluded chat shows the summary and no actions', () => {
  const decision = buildChatDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'concluded', running: false, round: 1, turns: 4, turnLimit: 4 },
    messages: [{
      kind: 'chat_conclusion',
      text: '结论：先做返工台账。',
      meta: {
        handoff: {
          topic: '返工',
          consensus: ['先做返工台账。'],
          disagreements: [],
          constraints: [],
          todos: [],
        },
      },
    }],
  })
  assert.equal(decision.title, '聊完了')
  assert.match(decision.detail, /返工台账/)
  assert.equal(decision.primary, null)
  assert.equal(decision.secondary, null)

  const interrupted = buildChatDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'discussing', running: false, turns: 2, turnLimit: 4 },
    messages: [],
  })
  assert.equal(interrupted.title, '刚才断了')
  assert.equal(interrupted.primary, null)
  assert.match(interrupted.detail, /发一句/)
  assert.doesNotMatch(interrupted.detail, /\d+\/\d+/)
})

test('the island line comes from the stored five-field consensus', () => {
  const decision = buildChatDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'concluded', running: false, round: 1, turns: 4, turnLimit: 4 },
    messages: [{
      kind: 'chat_conclusion',
      text: '原始讨论长文，不应该成为岛的一行结论。',
      meta: {
        handoff: {
          topic: '状态提示',
          consensus: ['先做最小版本'],
          disagreements: [],
          constraints: [],
          todos: [],
        },
      },
    }],
  })
  assert.match(decision.detail, /先做最小版本/)
  assert.doesNotMatch(decision.detail, /原始讨论长文/)
})

test('a free chat does not show speaking counts', () => {
  const running = buildChatDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'discussing', running: true, turns: 2, turnLimit: 4, speaker: 'worker' },
  })
  assert.equal(running.title, '正在聊')
  assert.doesNotMatch(running.title, /\d+/)
  assert.equal(running.key, 'chat-running')
  const waiting = buildChatDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'concluded', running: false, round: 1, turns: 4, turnLimit: 4 },
    messages: [{ kind: 'chat_conclusion', text: '结论：先做返工台账。' }],
  })
  assert.equal(waiting.key, 'chat-concluded')
})
