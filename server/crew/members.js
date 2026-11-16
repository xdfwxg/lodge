// 成员是身份，席位是它在某间房里的职责。memberId 跨房间稳定；
// 角色、工作区和发言预算仍留在 room.seatSpecs，换房间不换成员。
export const memberIdFor = (roomId, seatId) => {
  const room = String(roomId ?? '').replace(/^room-/, '')
  return `member-${room}-${seatId}`
}

export const memberIdOf = (room, seatId) => {
  const seat = (room?.seatSpecs ?? []).find(item => item.id === seatId)
  return typeof seat?.memberId === 'string' && seat.memberId !== ''
    ? seat.memberId
    : memberIdFor(room?.id, seatId)
}

const recordOf = (seat, id, now) => ({
  id,
  name: seat.name,
  ...(typeof seat.title === 'string' && seat.title !== '' ? { title: seat.title } : {}),
  ...(typeof seat.engine === 'string' && seat.engine !== '' ? { engine: seat.engine } : {}),
  ...(typeof seat.model === 'string' && seat.model !== '' ? { model: seat.model } : {}),
  skills: Array.isArray(seat.skills) ? [...seat.skills] : [],
  mcp: Array.isArray(seat.mcp) ? seat.mcp.map(item => ({ ...item })) : [],
  createdAt: now,
  updatedAt: now,
})

// 幂等：已有成员只补缺，不覆盖它在别处积累的技能和工具授权。
export const registerRoomMembers = (store, room, { now = Date.now() } = {}) => {
  let changed = false
  for (const seat of room?.seatSpecs ?? []) {
    const memberId = typeof seat.memberId === 'string' && seat.memberId !== ''
      ? seat.memberId
      : memberIdFor(room.id, seat.id)
    if (seat.memberId !== memberId) {
      seat.memberId = memberId
      changed = true
    }
    if (store.readMember(memberId) !== null) continue
    store.writeMember(recordOf(seat, memberId, now))
  }
  return changed
}

// 旧房间没有 memberId：启动时补一次，并建立成员记录；之后再读就是稳定身份。
export const migrateMemberRegistry = store => {
  for (const room of store.readRooms()) {
    if (!Array.isArray(room.seatSpecs) || room.seatSpecs.length === 0) continue
    if (registerRoomMembers(store, room)) store.writeRoom(room)
  }
}
