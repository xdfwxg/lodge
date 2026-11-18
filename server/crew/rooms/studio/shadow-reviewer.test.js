import assert from 'node:assert/strict'
import test from 'node:test'
import { createShadowReviewer, parseShadowAdvice, shadowPrompt } from './shadow-reviewer.js'

const room = over => ({
  id: 'room-1',
  chatRoom: { id: 'base-room', sessionRef: 'session-1' },
  shadowReview: true,
  shadowBot: { memberRef: 'bot-shadow', name: 'ShadowReview1' },
  hiddenBaseMessages: [],
  ...over,
})

const fakeStore = initial => {
  let current = initial
  return {
    readRoom: () => current,
    readMessages: () => [],
    updateRoom: (id, mutate) => {
      const next = structuredClone(current)
      if (mutate(next) === null) return null
      current = next
      return current
    },
  }
}

test('the prompt asks for a different angle and never a verdict', () => {
  const prompt = shadowPrompt({
    room: { goal: '导出报告' },
    stage: { title: '导出', acceptance: 'npm test' },
    evidence: { id: 'e1', text: '导出完成', meta: { command: 'npm test', exit: 0, diff: '+a' } },
  })
  assert.match(prompt, /不写 PASS 或 REJECT/)
  assert.match(prompt, /有没有漏/)
  assert.match(prompt, /npm test/)
  assert.match(prompt, /反例/)
  assert.match(prompt, /lodge-internal/)
})

test('advice parsing keeps the four fields and tolerates fences', () => {
  assert.deepEqual(
    parseShadowAdvice('```json\n{"summary":"缺边界","reasons":["没测空文件"],"risks":["同名覆盖"],"missingEvidence":["empty.log"]}\n```'),
    { source: 'shadow', summary: '缺边界', reasons: ['没测空文件'], risks: ['同名覆盖'], missingEvidence: ['empty.log'] },
  )
  assert.deepEqual(parseShadowAdvice('没有漏。'), { source: 'shadow', summary: '没有漏。' })
  assert.equal(parseShadowAdvice(''), null)
})

test('the reviewer asks the hidden bot once and hides the prompt', async () => {
  const store = fakeStore(room())
  const sent = []
  let reads = 0
  const engine = {
    history: async () => {
      reads += 1
      return {
        messages: reads === 1
          ? []
          : [{ id: 'reply-1', authorRef: 'bot-shadow', kind: 'text', text: '{"summary":"缺边界","reasons":["没测空文件"]}' }],
      }
    },
    rooms: async () => [],
  }
  const reviewer = createShadowReviewer({
    engine,
    store,
    roomId: 'room-1',
    sendToMember: async (memberId, text) => {
      sent.push({ memberId, text })
      return { messageId: 'prompt-1' }
    },
  })
  const result = await reviewer.ask({
    room: room(),
    stage: { title: '导出', acceptance: 'npm test' },
    evidence: { id: 'e1', text: 'ok', meta: { command: 'npm test', exit: 0 } },
  })
  assert.equal(result.available, true)
  assert.deepEqual(result.advice[0], { source: 'shadow', summary: '缺边界', reasons: ['没测空文件'] })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].memberId, 'shadow')
  assert.match(sent[0].text, /影子评审/)
  assert.deepEqual(store.readRoom().hiddenBaseMessages, ['prompt-1'])
})

test('a room without a shadow body never calls the base', async () => {
  let calls = 0
  const reviewer = createShadowReviewer({
    engine: { history: async () => ({ messages: [] }), rooms: async () => [] },
    store: fakeStore(room({ shadowReview: false, shadowBot: null })),
    roomId: 'room-1',
    sendToMember: async () => { calls += 1; return { messageId: 'x' } },
  })
  const result = await reviewer.ask({ room: room({ shadowReview: false, shadowBot: null }), stage: {}, evidence: undefined })
  assert.deepEqual(result, { available: false, advice: [] })
  assert.equal(calls, 0)
})
