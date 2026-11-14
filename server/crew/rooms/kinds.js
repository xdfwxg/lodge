import { resolveRoomType } from '../room-types/index.js'
import { chatKind } from './chat/kind.js'
import { studioKind } from './studio/kind.js'

export const roomKinds = [studioKind, chatKind]

export const kindForType = typeId => roomKinds.find(kind => kind.owns(typeId)) ?? null

// 没写房型的内部记录按工作室处理；未知房型返回 null，由调用方拒绝。
export const kindOfRoom = room => {
  const resolved = resolveRoomType(room?.roomType)
  return resolved === null ? null : kindForType(resolved.id)
}
