import { ROOM_STATE, ROUND_STATUS, TERMINAL_ROUND_STATUSES, WORK_ITEM_STATUS } from '../../../shared/states.js'

// work_round 的持久读写：一轮的目标、阶段、决策、费用和终态。
export const createRoundStore = ({ db }) => {
  const nextWorkRoundOrdinal = roomId => Number(
    db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS next FROM work_round WHERE room_id = ?').get(roomId)?.next ?? 1,
  )

  const writeWorkRound = round => {
    const now = Date.now()
    const stored = {
      ...round,
      ordinal: Number.isInteger(round.ordinal) ? round.ordinal : nextWorkRoundOrdinal(round.roomId),
      status: typeof round.status === 'string' ? round.status : ROUND_STATUS.planning,
      createdAt: round.createdAt ?? now,
      updatedAt: round.updatedAt ?? now,
      version: Number(round.version ?? 1),
    }
    db.prepare(
      'INSERT INTO work_round (id, room_id, project_id, ordinal, status, payload, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, ordinal = excluded.ordinal, status = excluded.status, payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at',
    ).run(
      stored.id, stored.roomId, stored.projectId ?? null, stored.ordinal, stored.status,
      JSON.stringify(stored), stored.version, stored.createdAt, stored.updatedAt,
    )
    return stored
  }

  const readWorkRound = (id, roomId = null) => {
    const row = roomId === null
      ? db.prepare('SELECT payload, version FROM work_round WHERE id = ?').get(id)
      : db.prepare('SELECT payload, version FROM work_round WHERE id = ? AND room_id = ?').get(id, roomId)
    if (row === undefined) return null
    return { ...JSON.parse(row.payload), version: row.version }
  }

  const readWorkRounds = roomId => db.prepare(
    'SELECT payload, version FROM work_round WHERE room_id = ? ORDER BY ordinal',
  ).all(roomId).map(row => ({ ...JSON.parse(row.payload), version: row.version }))

  const readWorkRoundsByProject = projectId => db.prepare(
    'SELECT payload, version FROM work_round WHERE project_id = ? ORDER BY updated_at DESC',
  ).all(projectId).map(row => ({ ...JSON.parse(row.payload), version: row.version }))

  const updateWorkRound = (id, mutate) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare('SELECT payload, version FROM work_round WHERE id = ?').get(id)
      if (row === undefined) { db.exec('ROLLBACK'); return null }
      const round = JSON.parse(row.payload)
      const change = mutate(round)
      if (change === null || change === undefined || change === false) { db.exec('ROLLBACK'); return null }
      const version = Number(row.version) + 1
      round.version = version
      round.updatedAt = Date.now()
      db.prepare(
        'UPDATE work_round SET project_id = ?, ordinal = ?, status = ?, payload = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?',
      ).run(
        round.projectId ?? null, round.ordinal ?? 1, round.status ?? 'planning',
        JSON.stringify(round), version, round.updatedAt, id, row.version,
      )
      db.exec('COMMIT')
      return round
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const deleteWorkRoundsForRoom = roomId => Number(
    db.prepare('DELETE FROM work_round WHERE room_id = ?').run(roomId).changes,
  )

  return {
    nextWorkRoundOrdinal,
    writeWorkRound,
    readWorkRound,
    readWorkRounds,
    readWorkRoundsByProject,
    updateWorkRound,
    deleteWorkRoundsForRoom,
  }
}

// 一轮开始/结束的事务：轮次、房间指针、事件一起提交。
export const createRoundLifecycleStore = ({ db, readRoom, writeWorkRound, readWorkRound, insertEvent, mirrorEvent, persistMessage = null }) => {
  const startWorkRound = ({ roomId, round, message = null }) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const open = db.prepare(
        `SELECT id FROM work_round WHERE room_id = ? AND status IN ('${ROUND_STATUS.planning}', '${ROUND_STATUS.active}') LIMIT 1`,
      ).get(roomId)
      if (open !== undefined) { db.exec('ROLLBACK'); return null }
      const roomRow = db.prepare('SELECT payload, version FROM room WHERE id = ?').get(roomId)
      if (roomRow === undefined) { db.exec('ROLLBACK'); return null }
      const stored = writeWorkRound(round)
      const room = JSON.parse(roomRow.payload)
      room.state = ROOM_STATE.active
      room.activeRoundId = stored.id
      room.idle = false
      room.noProgress = 0
      room.pauseReason = null
      // 这些字段已经属于轮次；旧版房间 payload 里如果还留着，清掉。
      delete room.advisorShadow
      delete room.previews
      delete room.reviewRetriedAt
      delete room.stageDiagnostics
      delete room.mergeResolved
      room.version = Number(roomRow.version) + 1
      db.prepare('UPDATE room SET payload = ?, version = ? WHERE id = ? AND version = ?')
        .run(JSON.stringify(room), room.version, roomId, roomRow.version)
      // 开轮和用户那句话同一个事务：要么都在，要么都不在。
      const storedMessage = message === null || persistMessage === null
        ? null
        : persistMessage({ ...message, roomId, workRoundId: stored.id })
      const event = insertEvent(roomId, {
        type: 'round.started',
        payload: {
          roundId: stored.id,
          ordinal: stored.ordinal,
          stages: (Array.isArray(stored.stages) ? stored.stages : []).map(stage => ({
            title: stage.title,
            kind: stage.kind,
            acceptance: stage.acceptance ?? '',
            manual: stage.manual === true,
            assignees: Array.isArray(stage.assignees) ? stage.assignees : [],
          })),
        },
      })
      db.exec('COMMIT')
      mirrorEvent(roomId, event)
      return { round: stored, room: readRoom(roomId), message: storedMessage }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const finishWorkRound = ({
    roomId,
    roundId,
    status,
    patch = {},
    roomPatch = {},
    eventType = '',
    eventPayload = {},
    idempotencyKey = null,
    message = null,
  }) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      if (idempotencyKey !== null) {
        const prior = db.prepare(
          'SELECT 1 FROM room_event WHERE room_id = ? AND idempotency_key = ?',
        ).get(roomId, idempotencyKey)
        if (prior !== undefined) {
          db.exec('ROLLBACK')
          return { duplicate: true, round: readWorkRound(roundId, roomId), room: readRoom(roomId) }
        }
      }
      const roundRow = db.prepare('SELECT payload, version FROM work_round WHERE id = ? AND room_id = ?').get(roundId, roomId)
      if (roundRow === undefined) { db.exec('ROLLBACK'); return null }
      const round = JSON.parse(roundRow.payload)
      if (TERMINAL_ROUND_STATUSES.has(round.status)) {
        db.exec('ROLLBACK')
        return { round, room: readRoom(roomId) }
      }
      Object.assign(round, patch, { status, updatedAt: Date.now(), version: Number(roundRow.version) + 1 })
      db.prepare(
        'UPDATE work_round SET project_id = ?, ordinal = ?, status = ?, payload = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?',
      ).run(
        round.projectId ?? null, round.ordinal ?? 1, round.status,
        JSON.stringify(round), round.version, round.updatedAt, roundId, roundRow.version,
      )
      // 轮次结束，属于这一轮的待办一起作废；房间级的卡（如审批）不受影响。
      db.prepare(
        `UPDATE work_item SET status = '${WORK_ITEM_STATUS.cancelled}', lease_until = NULL, updated_at = ? WHERE room_id = ? AND round_id = ? AND status IN ('${WORK_ITEM_STATUS.pending}', '${WORK_ITEM_STATUS.leased}')`,
      ).run(Date.now(), roomId, roundId)
      const roomRow = db.prepare('SELECT payload, version FROM room WHERE id = ?').get(roomId)
      if (roomRow === undefined) { db.exec('ROLLBACK'); return null }
      const room = JSON.parse(roomRow.payload)
      room.activeRoundId = null
      room.lastRoundId = roundId
      room.idle = true
      if (room.archivedAt !== undefined && room.archivedAt !== null) room.state = ROOM_STATE.stopped
      else if (room.state !== ROOM_STATE.stopped) room.state = ROOM_STATE.idle
      if (room.state === ROOM_STATE.idle) room.pauseReason = null
      Object.assign(room, roomPatch)
      room.version = Number(roomRow.version) + 1
      db.prepare('UPDATE room SET payload = ?, version = ? WHERE id = ? AND version = ?')
        .run(JSON.stringify(room), room.version, roomId, roomRow.version)
      const event = eventType === ''
        ? null
        : insertEvent(roomId, {
          type: eventType,
          payload: { ...eventPayload, roundId, status },
          idempotencyKey,
        })
      // 结论和轮次完成同一个事务：不会留下“有结论、轮次还没结束”的半状态。
      const storedMessage = message === null || persistMessage === null
        ? null
        : persistMessage({ ...message, roomId, workRoundId: roundId })
      db.exec('COMMIT')
      if (event !== null) mirrorEvent(roomId, event)
      return { round: readWorkRound(roundId, roomId), room: readRoom(roomId), message: storedMessage }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  // 停下的一轮接回来：轮次、房间指针和事件一起提交；目标、阶段和证据都不动。
  const reopenWorkRound = ({ roomId, roundId }) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const roundRow = db.prepare('SELECT payload, version FROM work_round WHERE id = ? AND room_id = ?').get(roundId, roomId)
      if (roundRow === undefined) { db.exec('ROLLBACK'); return null }
      const round = JSON.parse(roundRow.payload)
      if (round.status !== ROUND_STATUS.stopped) {
        db.exec('ROLLBACK')
        return { round: readWorkRound(roundId, roomId), room: readRoom(roomId) }
      }
      round.status = ROUND_STATUS.active
      delete round.stopReason
      round.updatedAt = Date.now()
      round.version = Number(roundRow.version) + 1
      db.prepare(
        'UPDATE work_round SET status = ?, payload = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?',
      ).run(round.status, JSON.stringify(round), round.version, round.updatedAt, roundId, roundRow.version)
      const roomRow = db.prepare('SELECT payload, version FROM room WHERE id = ?').get(roomId)
      if (roomRow === undefined) { db.exec('ROLLBACK'); return null }
      const stored = JSON.parse(roomRow.payload)
      stored.activeRoundId = roundId
      stored.lastRoundId = roundId
      stored.state = ROOM_STATE.active
      stored.idle = false
      stored.noProgress = 0
      stored.pauseReason = null
      stored.version = Number(roomRow.version) + 1
      db.prepare('UPDATE room SET payload = ?, version = ? WHERE id = ? AND version = ?')
        .run(JSON.stringify(stored), stored.version, roomId, roomRow.version)
      const event = insertEvent(roomId, { type: 'round.resumed', payload: { roundId } })
      db.exec('COMMIT')
      mirrorEvent(roomId, event)
      return { round: readWorkRound(roundId, roomId), room: readRoom(roomId) }
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return { startWorkRound, finishWorkRound, reopenWorkRound }
}
