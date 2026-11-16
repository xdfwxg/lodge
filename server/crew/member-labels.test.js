import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hostAddress,
  memberAddress,
  memberSurfaceName,
  memberDisplayName,
  memberLabelMap,
  toBaseMentions,
  unknownMentionsOf,
  toDisplayMentions,
  toDisplayText,
} from './member-labels.js'

const member = (id, name, baseName, ref) => ({ id, name, body: { kind: 'base', name: baseName, ref } })
const room = {
  members: [
    member('planner', '规划师', 'Plannerea924d', 'bot-planner'),
    member('executor', '执行者', 'Executorea924d', 'bot-executor'),
    member('verifier', '验收员', 'Verifierea924d', 'bot-verifier'),
  ],
}

test('display names turn into base names only when crossing the boundary', () => {
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

test('member display names come from the roster and fall back to the id', () => {
  assert.equal(memberDisplayName(room, 'executor'), '执行者')
  assert.equal(memberDisplayName(room, 'ghost'), 'ghost')
})

test('the label map is built from the roster only', () => {
  const withHandles = {
    members: [
      member('executor', '执行者', 'Executorea924d', 'bot-executor'),
      member('verifier', '验收员', 'Verifierea924d', 'bot-verifier'),
    ],
  }
  assert.deepEqual(memberLabelMap(withHandles), { executor: '执行者', verifier: '验收员' })
  assert.deepEqual(memberLabelMap({}), {})
})


test('base name conversion lives in one place', () => {
  assert.equal(memberSurfaceName(room, 'executor'), 'Executorea924d')
  assert.equal(memberSurfaceName({ members: [] }, 'executor'), '')
})

test('unknown @ names are reported, known names and @everyone are not', () => {
  assert.deepEqual(unknownMentionsOf(room, '@执行者 和 @张三 看下 @所有人'), ['张三'])
  assert.deepEqual(unknownMentionsOf(room, '@Executorea924d @规划师'), [])
  assert.deepEqual(unknownMentionsOf(room, '没有 @'), [])
})

test('only the transport layer resolves a member into a base address', () => {
  assert.deepEqual(memberAddress(room, 'executor'), {
    name: 'Executorea924d',
    mention: '@Executorea924d',
    memberRef: 'bot-executor',
  })
  assert.equal(memberAddress(room, 'ghost'), null)
  assert.equal(memberAddress({ members: [member('executor', '执行者', 'Executorea924d')] }, 'executor'), null)
  assert.deepEqual(hostAddress({ chatHost: { name: 'LodgeHost1', memberRef: 'bot-host' } }), {
    name: 'LodgeHost1',
    mention: '@LodgeHost1',
    memberRef: 'bot-host',
  })
  assert.equal(hostAddress({ chatHost: { name: 'LodgeHost1' } }), null)
})
