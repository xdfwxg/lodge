import { roleKindOf } from '../roster.js'

// 仅测试：把旧夹具字段一次性转成 room.members；产品代码不读这些字段。
export const normalizeTestRoom = room => {
  const specs = Array.isArray(room?.seatSpecs) ? room.seatSpecs : []
  if (specs.length === 0 && Array.isArray(room?.members) && room.members.length > 0 && typeof room.members[0] === 'object') return room
  const ids = Array.isArray(room?.members) ? room.members : []
  const members = specs.length > 0
    ? specs.map(spec => ({
      ...spec,
      roleKind: spec.roleKind ?? roleKindOf(spec.role),
      body: {
        kind: 'base',
        ...(room.seatBots?.[spec.id] === undefined ? {} : { ref: room.seatBots[spec.id] }),
        name: room.seatNames?.[spec.id] ?? spec.name,
      },
    }))
    : ids.map(id => ({
      id,
      name: room.seatNames?.[id] ?? id,
      role: id === room.leadSeat ? 'lead' : (room.verifiers ?? []).includes(id) ? 'verifier' : 'worker',
      roleKind: roleKindOf(id === room.leadSeat ? 'lead' : (room.verifiers ?? []).includes(id) ? 'verifier' : 'worker'),
      permissions: { read: false, exec: false, write: false },
      toolSurface: [],
      skills: [],
      mcp: [],
      body: { kind: 'base', ...(room.seatBots?.[id] === undefined ? {} : { ref: room.seatBots[id] }), name: room.seatNames?.[id] ?? id },
    }))
  return {
    ...room,
    members,
    leadMemberId: room.leadMemberId ?? room.leadSeat ?? members.find(member => member.role === 'lead')?.id ?? members[0]?.id ?? null,
  }
}

// 测试用 Assignment 内存表；产品代码用 SQLite assignment 表。
export const withAssignments = store => {
  const rows = []
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
