import { useEffect, useMemo, useRef, useState } from 'react'
import { requestAttention, syncRoomMenu } from '../system.js'
import { shouldNotify } from '../../../shared/quiet.js'

// 房间列表的两份投影：真正需要人处理的，以及侧栏/菜单里可见的。
export const useAttention = rooms => {
  const attentionRooms = useMemo(() => rooms.filter(room => !room.archivedAt), [rooms])
  const visibleRooms = attentionRooms
  const sidebarRooms = rooms

  const [needsText, setNeedsText] = useState('')
  const seenNeeds = useRef(null)
  const lastNotified = useRef(new Map())
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
      const now = Date.now()
      const room = appearing.find(item => shouldNotify({
        attention: item.needsYou,
        lastAt: lastNotified.current.get(item.id) ?? 0,
        now,
      }))
      if (room !== undefined) {
        lastNotified.current.set(room.id, now)
        const result = room.needsYou?.kind === 'result'
        requestAttention({
          count,
          notify: {
            roomId: room.id,
            title: result ? 'Lodge' : 'Lodge · 待处理',
            body: result ? `「${room.name}」的结果好了` : `${room.name}：${next[room.id]}`,
          },
        })
      } else if (count !== Object.keys(prev).length) {
        requestAttention({ count })
      }
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
