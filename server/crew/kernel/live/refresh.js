import { seatFor } from './projection.js'
import { roomPresentationOfRoom } from '../../rooms/kinds.js'
import { seatActivityOf } from './seat-activity.js'

export const createRoomRefresher = ({ store, engine, emit }) => {
  const refresh = (entry, { force = false } = {}) => {
    const now = Date.now()
    if (!force && now - entry.refreshedAt < 1_500) return
    entry.refreshedAt = now
    return (async () => {
      const room = store.readRoom(entry.roomId)
      if (room === null) return
      try {
        const bases = await engine.rooms()
        const seatBases = Object.entries(room.seatRooms ?? {})
          .map(([seat, ref]) => ({ seat, base: bases.find(item => item.id === ref.id) }))
          .filter(item => item.base !== undefined)
        const busySeats = seatBases.filter(item => item.base.working === true).map(item => item.seat)
        const chatBase = room.chatRoom === undefined ? undefined : bases.find(item => item.id === room.chatRoom.id)
        entry.baseRoom = chatBase ?? entry.baseRoom
        const updated = store.updateRoom(entry.roomId, current => {
          const toSeat = ref => (typeof ref === 'string' ? seatFor(current, ref) ?? ref : ref)
          const toSeats = map => Object.fromEntries(Object.entries(map ?? {}).map(([ref, value]) => [toSeat(ref), value]))
          const sameBusy = current.busy === true &&
            Array.isArray(current.busySeats) &&
            current.busySeats.length === busySeats.length &&
            current.busySeats.every((seat, index) => seat === busySeats[index])
          current.busy = busySeats.length > 0
          current.busySeat = busySeats[0] ?? ''
          current.busySeats = busySeats
          // 成员运行态归共享投影：谁在跑、谁在等，两套房型拿到同一份数据。
          const seatActivity = seatActivityOf(chatBase, toSeat)
          current.turnQueue = seatActivity.turnQueue
          current.presence = seatActivity.presence
          const members = new Set(current.members ?? [])
          current.heldSeats = members.size === 0
            ? seatActivity.heldSeats
            : seatActivity.heldSeats.filter(seat => members.has(seat))
          // 状态行的计时锚点：同一批成员连续工作时不清零。
          current.busySince = busySeats.length === 0
            ? null
            : sameBusy ? (current.busySince ?? now) : now
          Object.assign(current, roomPresentationOfRoom(current)?.refresh(chatBase, toSeat, toSeats) ?? {})
          return { events: [] }
        })
        if (updated === null) return
        emit('room', updated)
      } catch {
        return
      }
    })()
  }

  return { refresh }
}
