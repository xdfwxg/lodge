import assert from 'node:assert/strict'
import test from 'node:test'
import { answerDecision, normalizeAskDecision } from './decision.js'

const input = {
  question: '走哪条路？',
  options: [
    { id: 'keep-local', title: '保留本地', effect: '不覆盖刚改的内容' },
    { id: 'take-remote', title: '用远端', effect: '当前页回到远端版本' },
  ],
  recommended: 'keep-local',
}

test('a decision needs 2–3 options and a recommendation inside them', () => {
  const ok = normalizeAskDecision({ id: 'd1', input })
  assert.equal(ok.decision.status, 'open')
  assert.equal(ok.decision.options.length, 2)
  assert.equal(normalizeAskDecision({ input: { ...input, options: [input.options[0]] } }).error, '决策卡要 2–3 个选项。')
  assert.equal(normalizeAskDecision({ input: { ...input, recommended: 'missing' } }).error, '推荐项必须是其中一个选项 id。')
  assert.equal(normalizeAskDecision({ input: { ...input, options: [{ id: 'A', title: 'A', effect: 'x' }, input.options[1]] } }).error, '选项 id 只能用小写字母、数字和 -：A')
})

test('the user picks an option, the recommendation, or cancels', () => {
  const open = normalizeAskDecision({ id: 'd1', input }).decision
  assert.equal(answerDecision(open, 'take-remote').decision.answer.optionId, 'take-remote')
  assert.equal(answerDecision(open, 'default').decision.answer.optionId, 'keep-local')
  assert.equal(answerDecision(open, 'cancel').decision.status, 'cancelled')
  assert.equal(answerDecision(open, 'missing').error, '这个选项不在决策卡里。')
})
