import { resolveRoomType } from '../room-types/index.js'
import { chatKind } from './chat/kind.js'
import { studioKind } from './studio/kind.js'

export const roomKinds = [studioKind, chatKind]

// 两种窄接口：建房/能力只拿 mode，消息投影/注意力只拿 presentation。
const MODE_KEYS = [
  'id', 'owns', 'memberRole', 'memberSoul', 'validateRoster', 'supportsSubrooms', 'resolvePlan',
  'requiresGate', 'evaluateGate', 'supportsDelivery',
  'acceptsChatDecision', 'leadMemberIdOf', 'record',
  'initialMessages', 'provisionExtra', 'start',
  'bulletinAcceptance', 'approvalReadOnly',
]
const PRESENTATION_KEYS = [
  'filterMessages', 'hideActivity', 'acceptsDelta', 'needsYou', 'stateOf',
  'refresh', 'onMemberFailure', 'deliveryOf',
  'hostOf', 'speakerOf',
]

const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source[key]]))
const views = new Map(roomKinds.map(kind => [kind, {
  mode: pick(kind, MODE_KEYS),
  presentation: pick(kind, PRESENTATION_KEYS),
}]))

const kindForType = typeId => roomKinds.find(kind => kind.owns(typeId)) ?? null

// 没写房型的内部记录按工作室处理；未知房型返回 null，由调用方拒绝。
const kindOfRoom = room => {
  const resolved = resolveRoomType(room?.roomType)
  return resolved === null ? null : kindForType(resolved.id)
}

export const roomModeForType = typeId => {
  const kind = kindForType(typeId)
  return kind === null ? null : views.get(kind).mode
}

export const roomModeOfRoom = room => {
  const kind = kindOfRoom(room)
  return kind === null ? null : views.get(kind).mode
}

export const roomPresentationOfRoom = room => {
  const kind = kindOfRoom(room)
  return kind === null ? null : views.get(kind).presentation
}

