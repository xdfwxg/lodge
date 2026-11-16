export const MAX_SUBROOM_DEPTH = 3

const CLOSURE_LABELS = {
  open: '还没开始',
  planned: '安排好了',
  executing: '正在做',
  verifying: '待签字',
  signed: '签好了',
  rejected: '退回了',
}

export const canCreateSubroom = room => (
  room?.roomType === 'studio' &&
  room?.state === 'active' &&
  (room?.depth ?? 0) < MAX_SUBROOM_DEPTH
)

export const subroomStatusOf = room => {
  if (room?.state === 'complete') return '已完成'
  if (room?.state === 'paused') return '已暂停'
  if (room?.state === 'stopped') return '已停止'
  return CLOSURE_LABELS[room?.closure] ?? '正在做'
}

export const lastVerdictOf = room => [...(room?.messages ?? [])]
  .reverse()
  .find(message => message.kind === 'verdict')

export const verdictTextOf = verdict => {
  if (verdict === undefined || verdict === null) return '还没有检查'
  return verdict.meta?.pass === true ? '通过' : '退回'
}

// 父房只读树：按 childRoomIds 递归展开，父子关系来自房间记录，不从消息猜。
export const buildSubroomRows = (room, rooms = []) => {
  const byId = new Map(rooms.map(item => [item.id, item]))
  const seen = new Set([room.id])
  const rows = []
  const walk = (parent, depth) => {
    for (const id of parent.childRoomIds ?? []) {
      const child = byId.get(id)
      if (child === undefined || seen.has(id)) continue
      seen.add(id)
      rows.push({ room: child, depth, verdict: lastVerdictOf(child) })
      walk(child, depth + 1)
    }
  }
  walk(room, 0)
  return rows
}
