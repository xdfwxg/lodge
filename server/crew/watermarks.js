// 产品层游标：每个席位看到房间时间线的哪个位置。实际增量上下文由基座 delta-context 负责。
export const markSeatRead = ({ store, roomId, seat, emit }) => {
  const messages = store.readMessages(roomId)
  const seq = messages.at(-1)?.seq ?? 0
  const updated = store.updateRoom(roomId, current => {
    current.seatCursors = { ...(current.seatCursors ?? {}), [seat]: seq }
    return { events: [{ type: 'room.watermark', payload: { seat, seq } }] }
  })
  if (updated !== null) emit?.('room', updated)
  return updated
}
