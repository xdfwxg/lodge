import { useEffect, useMemo, useRef, useState } from 'react'
import { requestAttention, syncRoomMenu } from '../system.js'
import { shouldNotify } from '../../../shared/quiet.js'
import { needsAction } from '../needs.js'
import { orderRooms } from '../views/room-list.js'

// 房间列表的两份投影：真正需要人处理的，以及侧栏/菜单里可见的。
export const useAttention = rooms => {
  const attentionRooms = useMemo(() => rooms.filter(room => !room.archivedAt), [rooms])
  const visibleRooms = attentionRooms
  const orderedRooms = useMemo(() => orderRooms(visibleRooms), [visibleRooms])
  const sidebarRooms = rooms

  const [needsText, setNeedsText] = useState('')
  const seenNeeds = useRef(null)
  const lastNotified = useRef(new Map())
  useEffect(() => {
    const next = {}
    for (const room of attentionRooms) {
      const needs = needsAction(room)
      if (needs !== null) next[room.id] = needs.reason ?? needs.label ?? needs.kind ?? '待处理'
    }
    const prev = seenNeeds.current
    seenNeeds.current = next
    const count = Object.keys(next).length
    if (prev === null) {
      requestAttention({ count })
      return
    }
    const changed = attentionRooms.filter(room => needsAction(room) !== null && next[room.id] !== prev[room.id])
    const appearing = attentionRooms.filter(room => needsAction(room) !== null && prev[room.id] === undefined)
    if (appearing.length > 0) {
      const now = Date.now()
      const room = appearing.find(item => shouldNotify({
        attention: needsAction(item),
        lastAt: lastNotified.current.get(item.id) ?? 0,
        now,
      }))
      if (room !== undefined) {
        lastNotified.current.set(room.id, now)
        const needs = needsAction(room)
        const result = needs?.kind === 'result'
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
    if (changed.length === 0) {
      // 待处理清空后也要让读屏知道，别一直念上一批。
      setNeedsText(current => (current === '' ? current : ''))
      return
    }
    setNeedsText(changed.map(room => `${room.name}：${next[room.id]}`).join('；'))
  }, [attentionRooms])

  // 房间菜单只显示前 9 个；名字或顺序变了才重发，避免每条消息都重建菜单。
  const menuSignature = orderedRooms.slice(0, 9)
    .map(room => `${room.id}\u0000${room.name ?? ''}`)
    .join('\n')
  useEffect(() => {
    syncRoomMenu(orderedRooms.slice(0, 9).map(room => ({ id: room.id, name: room.name ?? '' })))
  }, [menuSignature])

  return { attentionRooms, visibleRooms, orderedRooms, sidebarRooms, needsText }
}
