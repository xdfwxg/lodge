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

export const kindForType = typeId => roomKinds.find(kind => kind.owns(typeId)) ?? null

// 没写房型的内部记录按工作室处理；未知房型返回 null，由调用方拒绝。
export const kindOfRoom = room => {
  const resolved = resolveRoomType(room?.roomType)
  return resolved === null ? null : kindForType(resolved.id)
}

// 跨上下文同步读取先拿 Facade，再取版本化 DTO；不要直接读对方的聚合字段。
export const facadeOfRoom = room => {
  const kind = kindOfRoom(room)
  return kind === null ? null : facades[kind.id] ?? null
}

export const snapshotOfRoom = room => facadeOfRoom(room)?.snapshot(room) ?? null
