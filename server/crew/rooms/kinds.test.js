import assert from 'node:assert/strict'
import test from 'node:test'
import { roomKinds, roomModeForType, roomPresentationOfRoom } from './kinds.js'

const MODE_KEYS = [
  'id', 'owns', 'seatRole', 'seatSoul', 'validateRoster', 'resolvePlan', 'needsPlannerTools',
  'requireIndependence', 'requiresGate', 'evaluateGate', 'supportsDelivery',
  'supportsSubrooms', 'acceptsChatDecision', 'leadSeatOf', 'record',
  'initialMessages', 'provisionExtra', 'start', 'applyStageDependencies',
  'bulletinAcceptance', 'approvalReadOnly', 'replayTransition',
]
const PRESENTATION_KEYS = [
  'filterMessages', 'hideActivity', 'acceptsDelta', 'needsYou', 'stateOf',
  'refresh', 'onSeatFailure', 'partialCount', 'deliveryOf', 'reviewOf',
]

test('every room mode implements the same substitutable contract', () => {
  for (const kind of roomKinds) {
    const mode = roomModeForType(kind.id)
    for (const key of MODE_KEYS) assert.ok(key in mode, `${kind.id} mode misses ${key}`)
    const presentation = roomPresentationOfRoom({ roomType: kind.id })
    for (const key of PRESENTATION_KEYS) assert.ok(key in presentation, `${kind.id} presentation misses ${key}`)
  }
})

test('seat souls carry only their own mode discipline', () => {
  const chat = roomModeForType('chat').seatSoul({ name: '甲', role: 'worker' })
  assert.match(chat, /聊天室/)
  assert.match(chat, /只讨论/)
  assert.doesNotMatch(chat, /执行官|git commit|验收/)
  const studio = roomModeForType('studio').seatSoul({ name: '验收员', role: 'verifier', prompt: '你是验收员。' })
  assert.match(studio, /PASS 或 REJECT/)
  assert.match(studio, /同一个房间目录/)
  assert.doesNotMatch(studio, /聊天室/)
})

test('narrow interfaces expose only their own responsibilities', () => {
  const mode = roomModeForType('chat')
  assert.deepEqual(Object.keys(mode).sort(), [...MODE_KEYS].sort())
  const presentation = roomPresentationOfRoom({ roomType: 'studio' })
  assert.deepEqual(Object.keys(presentation).sort(), [...PRESENTATION_KEYS].sort())
  assert.equal('needsYou' in mode, false)
  assert.equal('record' in presentation, false)
})
