// 测试用 Assignment 内存表；产品代码用 SQLite assignment 表。
export const withAssignments = store => {
  const rows = []
  // 测试用的内存 store 只有一个读改写入口；补上 updateRound，和真实 store 的两条写路径对齐。
  if (typeof store.updateRound !== 'function' && typeof store.updateRoom === 'function') {
    store.updateRound = store.updateRoom
  }
  return Object.assign(store, {
    writeAssignment(assignment) {
      const now = Date.now()
      const stored = { ...assignment, createdAt: assignment.createdAt ?? now, updatedAt: assignment.updatedAt ?? now }
      const index = rows.findIndex(item => item.id === stored.id)
      if (index >= 0) rows[index] = stored
      else rows.push(stored)
      return stored
    },
    readAssignments(roomId, { stage = null, status = null, before = null, limit = 500 } = {}) {
      let list = rows
        .filter(item => item.roomId === roomId)
        .filter(item => !Number.isInteger(stage) || item.stageIndex === stage)
        .filter(item => status === null || item.status === status)
      if (typeof before === 'string' && before !== '') {
        const index = list.findIndex(item => item.id === before)
        if (index >= 0) list = list.slice(0, index)
      }
      return list.slice(-limit)
    },
    pruneAssignments(roomId, { keep = 2000 } = {}) {
      const terminal = row => ['passed', 'rejected', 'failed', 'cancelled'].includes(row.status)
      const owned = rows.filter(item => item.roomId === roomId && terminal(item))
      const stale = owned.slice(0, Math.max(0, owned.length - keep))
      for (const item of stale) rows.splice(rows.indexOf(item), 1)
      return stale.length
    },
    readAssignment(id, roomId = null) {
      return rows.find(item => item.id === id && (roomId === null || item.roomId === roomId)) ?? null
    },
    updateAssignment(id, mutate) {
      const assignment = rows.find(item => item.id === id)
      if (assignment === undefined) return null
      const change = mutate(assignment)
      if (change === null || change === undefined || change === false) return null
      const next = { ...assignment, ...(change === true ? {} : change), updatedAt: Date.now() }
      const index = rows.findIndex(item => item.id === id)
      rows[index] = next
      return next
    },
  })
}
