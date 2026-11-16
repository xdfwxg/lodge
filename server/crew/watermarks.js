// 产品层游标：每个成员看到房间时间线的哪个位置。实际增量上下文由基座 delta-context 负责。
export const markMemberRead = ({ store, roomId, memberId, emit }) => {
  const messages = store.readMessages(roomId)
  const seq = messages.at(-1)?.seq ?? 0
  const updated = store.updateRoom(roomId, current => {
    current.memberCursors = { ...(current.memberCursors ?? {}), [memberId]: seq }
    return { events: [{ type: 'room.watermark', payload: { memberId, seq } }] }
  })
  if (updated !== null) emit?.('room', updated)
  return updated
}
