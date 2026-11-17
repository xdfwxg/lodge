import { roomNeedsYou } from './attention.js'
import { independenceLabel } from './digest.js'
import { capabilitiesFor } from './room-types/index.js'
import { roomPresentationOfRoom } from './rooms/kinds.js'

// 房间能力是 opt-in 开关，不是房型分类；默认关闭，旧房间不受影响。
const DEFAULT_ROOM_CAPABILITIES = Object.freeze({ dispatch: false })
const roomCapabilities = room => ({
  ...DEFAULT_ROOM_CAPABILITIES,
  ...(room?.capabilities ?? {}),
})

// 房间事件与状态查询共用同一份投影，UI 不再自己重算业务状态和独立性文案。
const publicBody = body => {
  if (body === undefined || body === null) return body
  const { ref, roomRef, sessionRef, ...rest } = body
  return rest
}

// 外层只看到房间、成员和交付；基座房间、身体地址和隐藏消息留在适配层。
export const presentRoom = (room, messages = [], assignments = []) => {
  const {
    chatRoom,
    chatHost,
    hiddenBaseMessages,
    seatBots,
    seatNames,
    seatSpecs,
    ...visibleRoom
  } = room
  const visible = {
    ...visibleRoom,
    members: (room.members ?? []).map(member => ({ ...member, body: publicBody(member.body) })),
    hostLabel: typeof chatHost?.displayName === 'string' ? chatHost.displayName : '',
  }
  const projection = roomPresentationOfRoom(room)?.projectWork?.(room, assignments) ?? null
  const view = {
    ...visible,
    ...(projection ?? {}),
    ...(projection === null ? {} : { assignments }),
  }
  return {
    ...view,
    revision: room.version ?? 1,
    capabilities: roomCapabilities(room),
    needsYou: roomNeedsYou(view, messages),
    modeCapabilities: capabilitiesFor(room.roomType),
    independenceLabel: independenceLabel(room),
    delivery: roomPresentationOfRoom(view)?.deliveryOf?.(view, messages) ?? null,
  }
}
