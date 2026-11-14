import assert from 'node:assert/strict'
import test from 'node:test'
import { seatDisplayName, seatHandle, seatLabelMap, seatMention, toBaseMentions, toDisplayMentions, toDisplayText } from './seat-labels.js'

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

test('the hidden chat host maps to the display name stored on the room', () => {
  const chatRoom = { ...room, chatHost: { memberRef: 'host-1', name: 'LodgeHost3f3199', displayName: 'Lodge 主持' } }
  assert.equal(toDisplayMentions(chatRoom, '@LodgeHost3f3199 请总结'), '@Lodge 主持 请总结')
  assert.equal(toDisplayText(chatRoom, 'LodgeHost3f3199 正在总结'), 'Lodge 主持 正在总结')
  assert.equal(toDisplayText(room, 'LodgeHost3f3199'), 'LodgeHost3f3199')
})

test('seat display names come from the roster and fall back to the id', () => {
  assert.equal(seatDisplayName(room, 'executor'), '执行者')
  assert.equal(seatDisplayName(room, 'ghost'), 'ghost')
})

test('the label map is built from the roster only', () => {
  const withHandles = {
    seatNames: { executor: 'Executorea924d', verifier: 'Verifierea924d' },
    seatSpecs: [
      { id: 'executor', name: '执行者' },
      { id: 'verifier', name: '验收员' },
    ],
  }
  assert.deepEqual(seatLabelMap(withHandles), { executor: '执行者', verifier: '验收员' })
  assert.deepEqual(seatLabelMap({ seatNames: { executor: 'Executorea924d' } }), {})
})


test('handle and mention conversion live in one place', () => {
  assert.equal(seatHandle(room, 'executor'), 'Executorea924d')
  assert.equal(seatHandle({ seatNames: {} }, 'executor'), '')
  assert.equal(seatMention(room, 'executor'), '@Executorea924d')
  assert.equal(seatMention({ seatNames: {} }, 'executor'), '')
})
