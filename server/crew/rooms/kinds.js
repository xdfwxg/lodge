import { resolveRoomType } from '../room-types/index.js'
import { chatFacade } from './chat/facade.js'
import { chatKind } from './chat/kind.js'
import { studioFacade } from './studio/facade.js'
import { studioKind } from './studio/kind.js'

export const roomKinds = [studioKind, chatKind]

const facades = {
  chat: chatFacade,
  studio: studioFacade,
}

// 两种窄接口：建房/能力只拿 mode，消息投影/注意力只拿 presentation。
const MODE_KEYS = [
  'id', 'owns', 'seatRole', 'seatSoul', 'validateRoster', 'resolvePlan', 'needsPlannerTools',
  'requireIndependence', 'requiresGate', 'evaluateGate', 'supportsDelivery',
  'supportsSubrooms', 'acceptsChatDecision', 'leadSeatOf', 'record',
  'initialMessages', 'provisionExtra', 'start', 'applyStageDependencies',
  'bulletinAcceptance', 'approvalReadOnly', 'replayTransition',
]
const PRESENTATION_KEYS = [
  'filterMessages', 'hideActivity', 'acceptsDelta', 'needsYou', 'stateOf',
  'refresh', 'onSeatFailure', 'partialCount',
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

// 跨上下文同步读取先拿 Facade，再取版本化 DTO；不要直接读对方的聚合字段。
const facadeOfRoom = room => {
  const kind = kindOfRoom(room)
  return kind === null ? null : facades[kind.id] ?? null
}

export const snapshotOfRoom = room => facadeOfRoom(room)?.snapshot(room) ?? null
