import { roomNeedsYou } from './attention.js'
import { buildDelivery } from './delivery.js'
import { independenceLabel, independencePolicyLabel } from './digest.js'
import { capabilitiesFor } from './room-capabilities.js'

// 房间能力是 opt-in 开关，不是房型分类；默认关闭，旧房间不受影响。
const DEFAULT_ROOM_CAPABILITIES = Object.freeze({ dispatch: false })
const roomCapabilities = room => ({
  ...DEFAULT_ROOM_CAPABILITIES,
  ...(room?.capabilities ?? {}),
})

// 房间事件与状态查询共用同一份投影，UI 不再自己重算业务状态和独立性文案。
export const presentRoom = (room, messages = [], ledger = null) => ({
  ...room,
  revision: room.version ?? 1,
  capabilities: roomCapabilities(room),
  parentRoomId: typeof room.parentRoomId === 'string' && room.parentRoomId !== '' ? room.parentRoomId : null,
  childRoomIds: Array.isArray(room.childRoomIds) ? room.childRoomIds : [],
  needsYou: roomNeedsYou(room, messages),
  modeCapabilities: capabilitiesFor(room.roomType),
  independenceLabel: independenceLabel(room),
  independencePolicyLabel: independencePolicyLabel(room),
  delivery: room.state === 'complete' && room.roomType !== 'chat' ? buildDelivery(room, messages, ledger) : null,
})
