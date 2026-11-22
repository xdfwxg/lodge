import assert from 'node:assert/strict'
import test from 'node:test'
import { roomKinds, roomLifecycleOfRoom, roomModeForType, roomPresentationOfRoom } from './kinds.js'
import { MENTION_ALL } from '../../../shared/mentions.js'

const MODE_KEYS = [
  'id', 'owns', 'memberRole', 'memberSoul', 'memberPrompt', 'validateRoster', 'supportsMemberAdd', 'allowsHostOnly', 'busyNow', 'messagePolicy', 'demoMessage', 'resolvePlan',
  'requiresGate', 'evaluateGate', 'supportsDelivery',
  'leadMemberIdOf', 'record',
  'initialMessages', 'provisionExtra', 'start',
  'bulletinAcceptance', 'approvalReadOnly',
]
const PRESENTATION_KEYS = [
  'filterMessages', 'hideActivity', 'acceptsDelta', 'needsYou',
  'refresh', 'projectWork', 'deliveryOf',
  'hostOf', 'speakerOf',
]
const LIFECYCLE_KEYS = ['markMemberFailure']

test('every room mode implements the same substitutable contract', () => {
  for (const kind of roomKinds) {
    const mode = roomModeForType(kind.id)
    for (const key of MODE_KEYS) assert.ok(key in mode, `${kind.id} mode misses ${key}`)
    const presentation = roomPresentationOfRoom({ roomType: kind.id })
    for (const key of PRESENTATION_KEYS) assert.ok(key in presentation, `${kind.id} presentation misses ${key}`)
    const lifecycle = roomLifecycleOfRoom({ roomType: kind.id })
    for (const key of LIFECYCLE_KEYS) assert.ok(key in lifecycle, `${kind.id} lifecycle misses ${key}`)
  }
})

test('member souls carry only their own mode discipline', () => {
  const chat = roomModeForType('chat').memberSoul({ name: '甲', role: 'worker' })
  assert.match(chat, /聊天室/)
  assert.match(chat, /可以只读查看|联网只读/)
  assert.doesNotMatch(chat, /执行官|git commit|验收/)
  const studio = roomModeForType('studio').memberSoul({ name: '验收员', role: 'verifier', prompt: '你是验收员。' })
  assert.match(studio, /PASS 或 REJECT/)
  assert.match(studio, /需要谁回应由系统安排/)
  assert.match(studio, /不用 @ 安排下一棒/)
  assert.match(studio, /不要自创角色/)
  assert.match(studio, /不重新规划/)
  assert.doesNotMatch(studio, /聊天室/)
  const worker = roomModeForType('studio').memberSoul({ name: '乙', role: 'worker', prompt: '你是乙。' })
  assert.match(worker, /不改目标/)
  assert.match(worker, /像对同事说话/)
  assert.doesNotMatch(worker, /PASS 或 REJECT/)
  const leadSoul = roomModeForType('studio').memberSoul({ name: '幕僚长', role: 'lead', prompt: '你是幕僚长。' })
  assert.match(leadSoul, /不写文件、不跑验收/)
  assert.match(leadSoul, /不再重复对齐/)
})

test('only the Lodge chat allows a host without member threads', () => {
  const chat = roomModeForType('chat')
  assert.equal(chat.allowsHostOnly({ lodge: true }), true)
  assert.equal(chat.allowsHostOnly({}), false)
})

test('message routing is a mode policy, not a room-type branch', () => {
  const chat = roomModeForType('chat')
  const room = { chat: { phase: 'discussing' }, members: [{ id: 'a', name: '甲' }] }
  const concluded = { chat: { phase: 'concluded', running: false }, members: [{ id: 'a', name: '甲' }] }
  assert.deepEqual(chat.messagePolicy({ room, text: '聊聊', mentions: [] }), { type: 'host' })
  assert.deepEqual(chat.messagePolicy({ room: concluded, text: '继续', mentions: [] }), { type: 'host' })
  assert.deepEqual(chat.messagePolicy({ room, text: '@甲 看这里', mentions: [] }), { type: 'host' })
  assert.deepEqual(chat.messagePolicy({ room, text: '@所有人 看这里', mentions: [] }), { type: 'host' })
  assert.deepEqual(chat.messagePolicy({ room: concluded, text: '@所有人 继续', mentions: [MENTION_ALL] }), { type: 'round' })
  assert.deepEqual(chat.messagePolicy({ room, text: '@所有人 继续', mentions: [MENTION_ALL] }), { type: 'round-busy' })
  assert.equal(chat.messagePolicy({ room, text: '@甲 看这里', mentions: ['a'] }), null)
  assert.equal(chat.messagePolicy({ room: concluded, text: '@甲 继续', mentions: ['a'] }), null)

  const studio = roomModeForType('studio')
  assert.equal(studio.messagePolicy({ room: { stages: [{ state: 'passed' }] } }), null)
  assert.equal(studio.messagePolicy({ room: { stages: [{ state: 'active' }] } }), null)
})

test('narrow interfaces expose only their own responsibilities', () => {
  const mode = roomModeForType('chat')
  assert.deepEqual(Object.keys(mode).sort(), [...MODE_KEYS].sort())
  const presentation = roomPresentationOfRoom({ roomType: 'studio' })
  assert.deepEqual(Object.keys(presentation).sort(), [...PRESENTATION_KEYS].sort())
  const lifecycle = roomLifecycleOfRoom({ roomType: 'studio' })
  assert.deepEqual(Object.keys(lifecycle).sort(), [...LIFECYCLE_KEYS].sort())
  assert.equal('needsYou' in mode, false)
  assert.equal('record' in presentation, false)
  assert.equal('markMemberFailure' in presentation, false)
})
