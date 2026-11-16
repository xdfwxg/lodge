import { memberForRef } from './projection.js'
import { roomPresentationOfRoom } from '../../rooms/kinds.js'
import { memberActivityOf } from './member-activity.js'

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
        const memberBases = (room.members ?? [])
          .map(member => ({ memberId: member.id, base: bases.find(item => item.id === member.body?.roomRef) }))
          .filter(item => item.base !== undefined)
        const busyMembers = memberBases.filter(item => item.base.working === true).map(item => item.memberId)
        const chatBase = room.chatRoom === undefined ? undefined : bases.find(item => item.id === room.chatRoom.id)
        entry.baseRoom = chatBase ?? entry.baseRoom
        const updated = store.updateRoom(entry.roomId, current => {
          const toMember = ref => (typeof ref === 'string' ? memberForRef(current, ref) ?? ref : ref)
          const toMembers = map => Object.fromEntries(Object.entries(map ?? {}).map(([ref, value]) => [toMember(ref), value]))
          const sameBusy = current.busy === true &&
            Array.isArray(current.busyMembers) &&
            current.busyMembers.length === busyMembers.length &&
            current.busyMembers.every((memberId, index) => memberId === busyMembers[index])
          current.busy = busyMembers.length > 0
          current.busyMember = busyMembers[0] ?? ''
          current.busyMembers = busyMembers
          // 成员运行态归共享投影：谁在跑、谁在等，两套房型拿到同一份数据。
          const activity = memberActivityOf(chatBase, toMember)
          current.turnQueue = activity.turnQueue
          current.presence = activity.presence
          const memberSet = new Set((current.members ?? []).map(member => member.id))
          current.heldMembers = memberSet.size === 0
            ? activity.heldMembers
            : activity.heldMembers.filter(memberId => memberSet.has(memberId))
          current.heldMessages = memberSet.size === 0
            ? activity.heldMessages
            : Object.fromEntries(Object.entries(activity.heldMessages).filter(([memberId]) => memberSet.has(memberId)))
          // 状态行的计时锚点：同一批成员连续工作时不清零。
          current.busySince = busyMembers.length === 0
            ? null
            : sameBusy ? (current.busySince ?? now) : now
          Object.assign(current, roomPresentationOfRoom(current)?.refresh(chatBase, toMember, toMembers) ?? {})
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
