// 交接历史的分页与保留策略。未收口的交接永远保留，只清理旧的终态。
export const ASSIGNMENT_KEEP = 2000

export const pageAssignments = (store, roomId, { stage = null, status = null, before = null, limit = 50 } = {}) => {
  const size = Math.max(1, Math.min(500, Number(limit) || 50))
  const rows = store.readAssignments(roomId, { stage, status, before, limit: size + 1 })
  const hasMore = rows.length > size
  const items = hasMore ? rows.slice(1) : rows
  return { items, hasMore, next: hasMore ? items[0]?.id ?? null : null }
}

export const compactRoom = (store, roomId, { keep = ASSIGNMENT_KEEP } = {}) => (
  store.pruneAssignments(roomId, { keep })
)

export const compactAssignments = store => {
  let removed = 0
  for (const room of store.readRooms()) removed += compactRoom(store, room.id)
  return removed
}
