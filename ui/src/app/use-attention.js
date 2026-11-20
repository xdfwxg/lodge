import { useEffect, useMemo, useRef, useState } from 'react'
import { requestAttention, syncRoomMenu } from '../system.js'

// 房间列表的两份投影：真正需要人处理的，以及侧栏/菜单里可见的。
export const useAttention = rooms => {
  const attentionRooms = useMemo(() => {
    const byId = new Map(rooms.map(room => [room.id, room]))
    return rooms.filter(room => {
      if (room.archivedAt) return false
      if (room.routineRun !== true) return true
      const goal = byId.get(room.routineGoalId)
      return goal === undefined || goal === null ||
        (goal.archivedAt !== undefined && goal.archivedAt !== null)
    })
  }, [rooms])
  const visibleRooms = useMemo(
    () => attentionRooms.filter(room => room.routineRun !== true),
    [attentionRooms],
  )
  const sidebarRooms = useMemo(() => rooms.filter(room => room.routineRun !== true), [rooms])

  const [needsText, setNeedsText] = useState('')
  const seenNeeds = useRef(null)
  useEffect(() => {
    const next = {}
    for (const room of attentionRooms) {
      if (room.needsYou) {
        next[room.id] = room.needsYou.reason ?? room.needsYou.label ?? room.needsYou.kind ?? '待处理'
      }
    }
    const prev = seenNeeds.current
    seenNeeds.current = next
    const count = Object.keys(next).length
    if (prev === null) {
      requestAttention({ count })
      return
    }
    const changed = attentionRooms.filter(room => room.needsYou && next[room.id] !== prev[room.id])
    const appearing = attentionRooms.filter(room => room.needsYou && prev[room.id] === undefined)
    if (appearing.length > 0) {
      const room = appearing[0]
      const result = room.needsYou?.kind === 'result'
      const run = room.needsYou?.kind === 'routine-run'
      requestAttention({
        count,
        notify: {
          roomId: room.id,
          title: result ? 'Lodge' : 'Lodge 需要你',
          body: result
            ? `「${room.name}」的结果好了`
            : run
              ? `「${room.name}」${room.needsYou.label ?? '这次需要你'}：${room.needsYou.reason ?? '需要处理'}`
              : `${room.name}：${next[room.id]}`,
        },
      })
    } else if (count !== Object.keys(prev).length) {
      requestAttention({ count })
    }
    if (changed.length === 0) return
    setNeedsText(changed.map(room => `${room.name}：${next[room.id]}`).join('；'))
  }, [attentionRooms])

  // 房间菜单只显示前 9 个；名字或顺序变了才重发，避免每条消息都重建菜单。
  const menuSignature = visibleRooms.slice(0, 9)
    .map(room => `${room.id}\u0000${room.name ?? ''}`)
    .join('\n')
  useEffect(() => {
    syncRoomMenu(visibleRooms.slice(0, 9).map(room => ({ id: room.id, name: room.name ?? '' })))
  }, [menuSignature])

  return { attentionRooms, visibleRooms, sidebarRooms, needsText }
}
