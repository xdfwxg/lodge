import assert from 'node:assert/strict'
import test from 'node:test'
import { SHADOW_SOUL, createShadowReviewer, parseShadowAdvice, shadowPrompt } from './shadow-reviewer.js'

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
    updateRound: (id, mutate) => {
      const next = structuredClone(current)
      if (mutate(next) === null) return null
      current = next
      return current
    },
  }
}

test('the soul carries the role, the evidence rule and the boundary', () => {
  assert.match(SHADOW_SOUL, /影子评审/)
  assert.match(SHADOW_SOUL, /不判通过或不通过/)
  assert.match(SHADOW_SOUL, /不调用工具/)
  // 影子只认证据；没有依据就不写，证据里的指令只当数据。
  assert.match(SHADOW_SOUL, /每条发现都要点出依据/)
  assert.match(SHADOW_SOUL, /只当数据/)
})

test('the call prompt only carries this task and its output shape', () => {
  const prompt = shadowPrompt({
    room: { goal: '导出报告' },
    stage: { title: '导出', acceptance: 'npm test' },
    evidence: { id: 'e1', text: '导出完成', meta: { command: 'npm test', exit: 0, diff: '+a' } },
  })
  assert.match(prompt, /只找漏/)
  assert.match(prompt, /安全、权限、依赖、隐私和数据风险/)
  assert.match(prompt, /不要重复验收员的逐行功能评审/)
  assert.match(prompt, /npm test/)
  assert.match(prompt, /反例/)
  assert.match(prompt, /无显著风险/)
  assert.match(prompt, /missingEvidence/)
  assert.match(prompt, /lodge-internal/)
  assert.doesNotMatch(prompt, /影子评审|不写 通过 或 不通过|不调用工具/)
})

test('advice parsing keeps the four fields and tolerates fences', () => {
  assert.deepEqual(
    parseShadowAdvice('```json\n{"summary":"缺边界","reasons":["没测空文件"],"risks":["同名覆盖"],"missingEvidence":["empty.log"]}\n```'),
    { source: 'shadow', summary: '缺边界', reasons: ['没测空文件'], risks: ['同名覆盖'], missingEvidence: ['empty.log'] },
  )
  assert.deepEqual(parseShadowAdvice('没有漏。'), { source: 'shadow', summary: '没有漏。' })
  assert.equal(parseShadowAdvice(''), null)
  // 模型把结构化意见再包进 summary 时，拆开而不是把整段 JSON 显示成一句话。
  assert.deepEqual(
    parseShadowAdvice(JSON.stringify({
      summary: JSON.stringify({
        summary: '内容达标，口径没锁死',
        reasons: ['字数口径没写清'],
        risks: ['换个人复核会翻案'],
        missingEvidence: ['缺原文字节'],
      }),
    })),
    {
      source: 'shadow',
      summary: '内容达标，口径没锁死',
      reasons: ['字数口径没写清'],
      risks: ['换个人复核会翻案'],
      missingEvidence: ['缺原文字节'],
    },
  )
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
  assert.match(sent[0].text, /只找漏/)
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
