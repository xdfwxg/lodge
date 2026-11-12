import assert from 'node:assert/strict'
import test from 'node:test'
import { seatDisplayName, toBaseMentions, toDisplayMentions, toDisplayText } from './seat-labels.js'

const room = {
  seatNames: {
    planner: 'Plannerea924d',
    executor: 'Executorea924d',
    verifier: 'Verifierea924d',
  },
  seatSpecs: [
    { id: 'planner', name: '规划师' },
    { id: 'executor', name: '执行者' },
    { id: 'verifier', name: '验收员' },
  ],
}

test('display names turn into base handles only when crossing the boundary', () => {
  assert.equal(toBaseMentions(room, '@执行者 先跑一遍'), '@Executorea924d 先跑一遍')
  assert.equal(toDisplayMentions(room, '@Executorea924d 报告好了'), '@执行者 报告好了')
  assert.equal(toDisplayMentions(room, '没有提任何人'), '没有提任何人')
  assert.equal(toDisplayText(room, 'Executorea924d 不在这个群组聊天中'), '执行者 不在这个群组聊天中')
})

test('seat display names fall back to handles and ids', () => {
  assert.equal(seatDisplayName(room, 'executor'), '执行者')
  assert.equal(seatDisplayName(room, 'ghost'), 'ghost')
  assert.equal(seatDisplayName({ seatNames: { executor: 'Executorea924d' } }, 'executor'), 'Executorea924d')
})
