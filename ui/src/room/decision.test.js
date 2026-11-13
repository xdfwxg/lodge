import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDecision, showsDecisionCard } from './decision.js'

const view = (over = {}) => ({
  stages: [{
    index: 1,
    title: '修复 pad',
    state: 'active',
    acceptanceLabel: 'npm test',
    evidence: [{ id: 'e1', command: 'npm test', exit: 0, manual: false }],
    verdict: { pass: true, text: '测试通过，只改了 src/pad.js。' },
    rework: [],
    ...over,
  }],
})

const room = (over = {}) => ({
  roomType: 'studio',
  state: 'active',
  seatNames: { worker: '执行者', verifier: '验收员' },
  seatSpecs: [{ id: 'worker', name: '执行者' }, { id: 'verifier', name: '验收员' }],
  verifiers: ['verifier'],
  needsYou: null,
  ...over,
})

test('signoff is one decision with one primary action', () => {
  const decision = buildDecision(room({ needsYou: { kind: 'signoff', label: '等你签字' } }), view())
  assert.equal(decision.title, '验收通过，等你签字')
  assert.equal(decision.primary.label, '签字通过')
  assert.equal(decision.secondary.label, '查看证据')
  assert.match(decision.detail, /测试通过/)
})

test('review tells the user who is working and still links evidence', () => {
  const decision = buildDecision(room({ needsYou: { kind: 'review', label: '待复核' } }), view())
  assert.equal(decision.title, '验收员正在独立复核')
  assert.equal(decision.primary, undefined)
  assert.equal(decision.secondary.label, '查看证据')
  assert.match(decision.detail, /npm test/)
  const partial = buildDecision(room({ needsYou: { kind: 'review', label: '待复核 · 已回报 1/2' } }), view())
  assert.match(partial.detail, /1\/2/)
})

test('rework leads with the reject reason and a redo action', () => {
  const decision = buildDecision(room({ needsYou: { kind: 'rework', label: '验收退回 · 等你处理' } }), view({
    verdict: { pass: false, text: '测试没有覆盖空字符串。' },
  }))
  assert.equal(decision.title, '验收退回，等你决定')
  assert.equal(decision.primary.label, '让执行官重做')
  assert.match(decision.detail, /空字符串/)
})

test('executing has no action, and a quota pause explains the next step', () => {
  const running = buildDecision(room({ busySeat: 'worker' }), view())
  assert.equal(running.key, 'executing')
  assert.match(running.title, /执行者 正在处理/)
  const fromTask = buildDecision(room(), view({ tasks: [{ owner: 'worker', status: 'working' }] }))
  assert.match(fromTask.title, /执行者 正在处理/)
  const paused = buildDecision(room({
    state: 'paused',
    pauseReason: 'seat_error',
    seatError: { seat: 'worker', kind: 'quota' },
  }), view())
  assert.equal(paused.title, '执行者额度不足，等你处理')
  assert.equal(paused.primary.label, '继续')
})

test('an executing or completed studio room does not render a redundant card', () => {
  const executing = buildDecision(room({ busySeat: 'worker' }), view())
  assert.equal(executing.key, 'executing')
  assert.equal(showsDecisionCard(executing), false)
  const complete = buildDecision(room({ state: 'complete', delivery: { changedFiles: [] } }), view())
  assert.equal(complete.key, 'complete')
  assert.equal(showsDecisionCard(complete), false)
  const chatComplete = buildDecision({
    roomType: 'chat',
    state: 'complete',
    chat: { phase: 'accepted', accepted: true, running: false, round: 1, turns: 4, turnLimit: 4 },
    messages: [{ kind: 'chat_conclusion', text: '结论：先做返工台账。' }],
  }, null)
  assert.equal(chatComplete.key, 'chat-complete')
  assert.equal(showsDecisionCard(chatComplete), false)
  assert.equal(showsDecisionCard(buildDecision(room({ needsYou: { kind: 'signoff' } }), view())), true)
})

test('chat awaiting decision shows the conclusion and the next actions', () => {
  const decision = buildDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'awaiting_decision', running: false, round: 1, turns: 4, turnLimit: 4 },
    messages: [{ kind: 'chat_conclusion', text: '结论：先做返工台账。' }],
  }, null)
  assert.equal(decision.title, '讨论结束，等你确认结论')
  assert.match(decision.detail, /返工台账/)
  assert.equal(decision.primary.label, '确认结论')
  assert.equal(decision.extra.label, '用结论新建工作室')
  const complete = buildDecision({
    roomType: 'chat',
    state: 'complete',
    chat: { phase: 'accepted', accepted: true, running: false, round: 1, turns: 4, turnLimit: 4 },
    messages: [{ kind: 'chat_conclusion', text: '结论：先做返工台账。' }],
  }, null)
  assert.equal(complete.title, '聊天已结束')
  assert.equal(complete.extra.label, '用结论新建工作室')

  const interrupted = buildDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'discussing', running: false, turns: 2, turnLimit: 4 },
    messages: [],
  }, null)
  assert.equal(interrupted.title, '讨论中断，等你处理')
  assert.equal(interrupted.primary.action, 'chat-resume')
  assert.doesNotMatch(interrupted.detail, /\d+\/\d+/)
})

test('a free chat does not show speaking counts or a running card', () => {
  const running = buildDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'discussing', running: true, turns: 2, turnLimit: 4, speaker: 'worker' },
  }, null)
  assert.equal(running.title, '讨论中')
  assert.doesNotMatch(running.title, /\d+/)
  assert.equal(showsDecisionCard(running), false)
  const waiting = buildDecision({
    roomType: 'chat',
    state: 'active',
    chat: { phase: 'awaiting_decision', running: false, round: 1, turns: 4, turnLimit: 4 },
    messages: [{ kind: 'chat_conclusion', text: '结论：先做返工台账。' }],
  }, null)
  assert.equal(showsDecisionCard(waiting), false)
})
