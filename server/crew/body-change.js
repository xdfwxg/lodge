// 换身体、加成员、移除成员共用同一组时机规则，避免三条路径各写一份、各漏一项。
export const bodyChangeBlocker = (room, verb) => {
  if (room.state !== 'active' && room.state !== 'paused') return `房间已经结束，不能再${verb}`
  if (typeof room.connectionError === 'string' && room.connectionError !== '') {
    return `基座连接中断，等连上再${verb}`
  }
  const chatRunning = room.chat?.running === true || room.chatWorking === true
  if (room.busy === true || chatRunning || (room.turnQueue ?? []).length > 0) {
    return `房间正在做事，等这一回合结束再${verb}`
  }
  if (room.pauseReason === 'approval') return `先处理待确认的操作，再${verb}`
  return null
}
