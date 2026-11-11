import { roomNeedsYou } from './attention.js'
import { independenceLabel, independencePolicy } from './digest.js'

// 房间事件与状态查询共用同一份投影，UI 不再自己重算业务状态和独立性文案。
export const presentRoom = (room, messages = []) => ({
  ...room,
  revision: room.version ?? 1,
  needsYou: roomNeedsYou(room, messages),
  independenceLabel: independenceLabel(room),
  independencePolicy: independencePolicy(room),
})
