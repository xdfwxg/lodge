import assert from 'node:assert/strict'
import test from 'node:test'
import { chatBriefOf } from './brief.js'

const conclusion = (round, text, handoffBrief = null) => ({
  kind: 'chat_conclusion',
  text,
  meta: { round, ...(handoffBrief === null ? {} : { handoffBrief }) },
})

test('the last conclusion becomes the shared brief', () => {
  const brief = chatBriefOf([
    conclusion(1, '上一轮结论', {
      consensus: ['住上沿'],
      disagreements: ['要不要一直走'],
      unknowns: ['夜里会不会挡光'],
      constraints: ['不能挡内容'],
      todos: ['画一版'],
    }),
  ], { round: 2 })
  assert.equal(brief, '共识：住上沿；分歧：要不要一直走；未定：夜里会不会挡光；约束：不能挡内容')
})

test('a conclusion without handoffBrief still gives its text', () => {
  assert.equal(chatBriefOf([conclusion(1, '大家倾向先做小的。')], { round: 2 }), '大家倾向先做小的。')
})

test('the current round conclusion is not its own brief', () => {
  assert.equal(chatBriefOf([conclusion(2, '这一轮的结论')], { round: 2 }), '')
})

test('no conclusion means no brief', () => {
  assert.equal(chatBriefOf([], { round: 1 }), '')
})

test('long items are clipped instead of flooding the next turn', () => {
  const brief = chatBriefOf([conclusion(1, '', { consensus: ['甲'.repeat(300)] })], { round: 2, limit: 200 })
  assert.ok(brief.length <= 200)
  assert.match(brief, /…$/)
})
