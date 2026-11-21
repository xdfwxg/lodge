// Assignment 是房间内的一次交接；存储按轮次隔离，正文留在 payload。
export const createAssignmentStore = ({ db, readRoom, roundIdForRead }) => {
  const readAssignment = (id, roomId = null) => {
    const row = roomId === null
      ? db.prepare('SELECT payload FROM assignment WHERE id = ?').get(id)
      : db.prepare('SELECT payload FROM assignment WHERE id = ? AND room_id = ?').get(id, roomId)
    return row === undefined ? null : JSON.parse(row.payload)
  }

  const readAssignments = (roomId, { workRoundId, stage = null, status = null, before = null, limit = 500 } = {}) => {
    const where = ['room_id = ?']
    const params = [roomId]
    const scoped = workRoundId === undefined ? roundIdForRead(roomId) : workRoundId
    if (typeof scoped === 'string' && scoped !== '') { where.push('work_round_id = ?'); params.push(scoped) }
    if (Number.isInteger(stage)) { where.push('stage = ?'); params.push(stage) }
    if (typeof status === 'string' && status !== '') { where.push('status = ?'); params.push(status) }
    if (typeof before === 'string' && before !== '') {
      const anchor = db.prepare('SELECT created_at, rowid AS row_id FROM assignment WHERE id = ? AND room_id = ?').get(before, roomId)
      if (anchor !== undefined) {
        where.push('(created_at < ? OR (created_at = ? AND rowid < ?))')
        params.push(anchor.created_at, anchor.created_at, anchor.row_id)
      }
    }
    const rows = db.prepare(`SELECT payload FROM assignment WHERE ${where.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(...params, Math.max(1, Math.min(5000, Number(limit) || 500)))
    return rows.reverse().map(row => JSON.parse(row.payload))
  }

  const pruneAssignments = (roomId, { keep = 2000 } = {}) => {
    const size = Math.max(0, Number(keep) || 0)
    const terminal = "status IN ('passed', 'rejected', 'failed', 'cancelled')"
    return Number(db.prepare(`DELETE FROM assignment WHERE id IN (SELECT id FROM assignment WHERE room_id = ? AND ${terminal} ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?)`)
      .run(roomId, size).changes)
  }

  const writeAssignment = assignment => {
    const now = Date.now()
    const room = readRoom(assignment.roomId)
    const workRoundId = assignment.workRoundId ?? room?.activeRoundId ?? null
    const stored = {
      ...assignment,
      ...(workRoundId === null ? {} : { workRoundId }),
      createdAt: assignment.createdAt ?? now,
      updatedAt: assignment.updatedAt ?? now,
    }
    db.prepare(
      'INSERT INTO assignment (id, room_id, work_round_id, stage, status, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET work_round_id = excluded.work_round_id, stage = excluded.stage, status = excluded.status, updated_at = excluded.updated_at, payload = excluded.payload',
    ).run(
      stored.id, stored.roomId, stored.workRoundId ?? null, stored.stageIndex ?? 0,
      stored.status ?? 'created', stored.createdAt, stored.updatedAt, JSON.stringify(stored),
    )
    return stored
  }

  const updateAssignment = (id, mutate) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare('SELECT payload FROM assignment WHERE id = ?').get(id)
      if (row === undefined) { db.exec('ROLLBACK'); return null }
      const assignment = JSON.parse(row.payload)
      const change = mutate(assignment)
      if (change === null || change === undefined || change === false) { db.exec('ROLLBACK'); return null }
      const stored = { ...assignment, ...(change === true ? {} : change), updatedAt: Date.now() }
      db.prepare('UPDATE assignment SET work_round_id = ?, stage = ?, status = ?, updated_at = ?, payload = ? WHERE id = ?')
        .run(stored.workRoundId ?? null, stored.stageIndex ?? 0, stored.status ?? 'created', stored.updatedAt, JSON.stringify(stored), id)
      db.exec('COMMIT')
      return stored
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const deleteAssignments = roomId => Number(db.prepare('DELETE FROM assignment WHERE room_id = ?').run(roomId).changes)

  return { readAssignment, readAssignments, writeAssignment, updateAssignment, deleteAssignments, pruneAssignments }
}
