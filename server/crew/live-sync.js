export const createSeatSync = ({ store, engine, projector }) => {
  const syncSeat = async (entry, seat) => {
    if (entry.syncing.has(seat)) return
    const target = entry.seats.get(seat)
    if (target === undefined) return
    entry.syncing.add(seat)
    try {
      const { messages } = await engine.history(target.sessionRef)
      for (const message of messages) {
        entry.turns.trackTool(message)
        if (message.kind === 'turn') {
          entry.turns.captureTurn(message.turn, message.authorRef)
        } else {
          const stored = projector.toStored(entry.roomId, message)
          if (stored !== null) store.upsertMessage(stored)
        }
      }
    } finally {
      entry.syncing.delete(seat)
    }
  }

  const subscribeSeat = (entry, seat, { answerPermission, refresh }) => {
    const target = entry.seats.get(seat)
    if (target === undefined) return
    target.unsubscribe = engine.subscribe({
      roomId: target.roomRef,
      sessionRef: target.sessionRef,
      onState: state => {
        if (state.connected) void syncSeat(entry, seat)
      },
      onEvent: event => {
        if (event.type === 'room') {
          refresh(entry, { force: true })
          return
        }
        const message = event.message
        if (message?.card?.requestType === 'permission') {
          void answerPermission(entry, seat, message)
          return
        }
        entry.turns.trackTool(message)
        if (message.kind === 'turn') {
          entry.turns.captureTurn(message.turn, message.authorRef)
          refresh(entry, { force: true })
        } else {
          const stored = projector.toStored(entry.roomId, message)
          if (stored !== null) store.upsertMessage(stored)
          refresh(entry)
        }
      },
    })
  }

  return { syncSeat, subscribeSeat }
}
