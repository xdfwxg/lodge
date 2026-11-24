import assert from 'node:assert/strict'
import test from 'node:test'
import { roomKinds, roomLifecycleOfRoom, roomModeForType, roomPresentationOfRoom } from './kinds.js'

const MODE_KEYS = [
  'id', 'owns', 'memberRole', 'memberSoul', 'memberPrompt', 'validateRoster', 'supportsMemberAdd', 'allowsHostOnly', 'busyNow', 'demoMessage', 'resolvePlan',
  'requiresGate', 'evaluateGate', 'supportsDelivery',
  'leadMemberIdOf', 'record', 'chatMembersOf',
  'initialMessages', 'provisionExtra', 'start',
  'bulletinAcceptance', 'approvalReadOnly',
]
const PRESENTATION_KEYS = [
  'filterMessages', 'hideActivity', 'acceptsDelta', 'needsYou',
  'refresh', 'projectWork', 'deliveryOf',
  'hostOf', 'speakerOf', 'issuesOf', 'retroOf',
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

test('the studio mode exposes who is in the base room chat', () => {
  const mode = roomModeForType('studio')
  assert.equal(typeof mode.chatMembersOf, 'function')
  assert.deepEqual(
    mode.chatMembersOf({
      stages: [{ title: '目标对齐', state: 'pending' }],
      members: [{ id: 'planner', role: 'lead' }, { id: 'executor', role: 'worker' }],
    }),
    ['planner'],
  )
})

test('member souls carry only their own mode discipline', () => {
  const chat = roomModeForType('chat').memberSoul({ name: '甲', role: 'worker' })
  assert.match(chat, /聊天室/)
  assert.match(chat, /可以只读查看|联网只读/)
  assert.doesNotMatch(chat, /执行官|git commit|验收/)
  const studio = roomModeForType('studio').memberSoul({ name: '验收员', role: 'verifier', prompt: '你是验收员。' })
  assert.match(studio, /复核副本/)
  assert.match(studio, /diff 之外/)
  assert.match(studio, /知道彼此的存在和能力/)
  // 接力那句只写一次：在成员的工作契约里，系统负责投递。
  assert.match(studio, /交给谁（写名字，不带 @）/)
  assert.match(studio, /系统会把完整任务送到对方手里/)
  assert.match(studio, /不要自创角色/)
  assert.doesNotMatch(studio, /聊天室/)
  const worker = roomModeForType('studio').memberSoul({ name: '乙', role: 'worker', prompt: '你是乙。' })
  assert.match(worker, /只改实现所需的文件/)
  assert.match(worker, /像给同事发消息/)
  assert.doesNotMatch(worker, /PASS 或 REJECT/)
  const leadSoul = roomModeForType('studio').memberSoul({ name: '幕僚长', role: 'lead', prompt: '你是幕僚长。' })
  assert.match(leadSoul, /不写文件、不验收|不重复派活/)
  assert.match(leadSoul, /不重复派活/)
})

test('only the Lodge chat allows a host without member threads', () => {
  const chat = roomModeForType('chat')
  assert.equal(chat.allowsHostOnly({ lodge: true }), true)
  assert.equal(chat.allowsHostOnly({}), false)
})

test('message routing lives in each room service, not the narrow mode contract', () => {
  for (const kind of roomKinds) {
    assert.equal('messagePolicy' in roomModeForType(kind.id), false, `${kind.id} still exposes routing in the mode contract`)
  }
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

test('a prompt that already names the gate tools is not repeated by the system rules', () => {
  const soul = roomModeForType('studio').memberSoul({
    name: '规划师',
    role: 'lead',
    prompt: '用 lodge_gate_ask_decision 出卡，用 lodge_gate_ask_question 提问，用 lodge_gate_stop_round 停下。',
  })
  assert.equal((soul.match(/lodge_gate_ask_decision/g) ?? []).length, 1)
  assert.equal((soul.match(/lodge_gate_ask_question/g) ?? []).length, 1)
  assert.equal((soul.match(/lodge_gate_stop_round/g) ?? []).length, 1)
})
