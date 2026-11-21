import { roomModeOfRoom } from './rooms/kinds.js'

// 换身体、加成员、移除成员共用同一组时机规则，避免三条路径各写一份、各漏一项。
export const bodyChangeBlocker = (room, verb) => {
  if (room.archivedAt) return `房间已归档，先取消归档再${verb}`
  if (room.state === 'stopped') return `房间已停止，继续后再${verb}`
  if (typeof room.connectionError === 'string' && room.connectionError !== '') {
    return `Lodge 服务连接中断，等连上再${verb}`
  }
  const modeBusy = roomModeOfRoom(room)?.busyNow?.(room) === true
  if ((room.busyMembers ?? []).length > 0 || modeBusy || (room.turnQueue ?? []).length > 0) {
    return `房间正在做事，等手上这次做完再${verb}`
  }
  if (room.pauseReason === 'approval') return `先处理待确认的操作，再${verb}`
  return null
}
