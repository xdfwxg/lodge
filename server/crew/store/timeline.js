import { randomUUID } from 'node:crypto'
import { appendTranscript, writeEvidence } from '../room-repo.js'
import { workRoundIdOf } from '../../../shared/work-round.js'

// 时间线是消息、证据和事件的唯一读法；work_round_id=NULL 是房间级消息。
export const createTimelineStore = ({
  db,
  emit,
  readRoom,
  roundIdForRead,
  insertEvent,
  mirrorEvent,
}) => {
  const nextSeq = () => Number(db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages').get().next)

  const readMessages = (roomId, { workRoundId, roomLevel = workRoundId === undefined } = {}) => {
    const scoped = workRoundId === undefined ? roundIdForRead(roomId) : workRoundId
    const rows = scoped === null
      ? db.prepare('SELECT payload FROM messages WHERE room_id = ? ORDER BY seq').all(roomId)
      : roomLevel
        ? db.prepare('SELECT payload FROM messages WHERE room_id = ? AND (work_round_id = ? OR work_round_id IS NULL) ORDER BY seq').all(roomId, scoped)
        : db.prepare('SELECT payload FROM messages WHERE room_id = ? AND work_round_id = ? ORDER BY seq').all(roomId, scoped)
    return rows.map(row => JSON.parse(row.payload))
  }

  const readRecentMessages = (roomId, limit = 5000, { workRoundId, roomLevel = workRoundId === undefined } = {}) => {
    const size = Math.max(1, Math.min(10000, Number(limit) || 5000))
    const scoped = workRoundId === undefined ? roundIdForRead(roomId) : workRoundId
    const rows = scoped === null
      ? db.prepare('SELECT payload FROM (SELECT seq, payload FROM messages WHERE room_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq').all(roomId, size)
      : roomLevel
        ? db.prepare('SELECT payload FROM (SELECT seq, payload FROM messages WHERE room_id = ? AND (work_round_id = ? OR work_round_id IS NULL) ORDER BY seq DESC LIMIT ?) ORDER BY seq').all(roomId, scoped, size)
        : db.prepare('SELECT payload FROM (SELECT seq, payload FROM messages WHERE room_id = ? AND work_round_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq').all(roomId, scoped, size)
    return rows.map(row => JSON.parse(row.payload))
  }

  const maxMessageSeq = roomId => db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE room_id = ?').get(roomId)?.seq ?? 0

  const readEvidence = (roomId, { workRoundId } = {}) => readMessages(
    roomId,
    workRoundId === undefined ? {} : { workRoundId },
  )
    .filter(message => message.kind === 'evidence' && (message.meta?.kind === 'command' || message.meta?.kind === 'manual'))
    .map(message => ({
      id: message.id,
      roomId: message.roomId,
      seq: message.seq,
      kind: message.kind,
      authorId: message.authorId,
      text: message.text,
      at: message.ts,
      meta: message.meta ?? {},
    }))

  const readMessagesSince = (since, { limit = 5000 } = {}) => db.prepare(
    'SELECT payload FROM (SELECT seq, payload FROM messages WHERE seq > ? ORDER BY seq DESC LIMIT ?) ORDER BY seq',
  ).all(since, Math.max(1, Math.min(10000, Number(limit) || 5000))).map(row => JSON.parse(row.payload))

  const persistMessage = (message, { transcript = true } = {}) => {
    const room = readRoom(message.roomId)
    if (message.kind === 'evidence' && transcript) {
      message.meta = { ...message.meta, evidenceRef: `evidence/${message.id}.json` }
    }
    if (transcript) {
      appendTranscript(room ?? message.roomId, message)
      if (message.kind === 'evidence') writeEvidence(room ?? message.roomId, message)
    }
    db.prepare('INSERT INTO messages (seq, id, room_id, work_round_id, payload) VALUES (?, ?, ?, ?, ?)')
      .run(message.seq, message.id, message.roomId, workRoundIdOf(message), JSON.stringify(message))
    return message
  }

  // 一条消息先按自己的时间找轮次；迟到消息不能因为新轮已经开始就落进新轮。
  const roundAt = (roomId, at) => {
    if (!Number.isFinite(at)) return undefined
    let chosen
    for (const row of db.prepare('SELECT id, payload FROM work_round WHERE room_id = ? ORDER BY ordinal').all(roomId)) {
      const round = JSON.parse(row.payload)
      if (Number.isFinite(round.startedAt) && at >= round.startedAt) chosen = row.id
    }
    return chosen
  }

  // 工作室的消息属于某一轮，当前没有活动轮时归到上一轮；聊天室保持房间级连续时间线。
  const roundForMessage = (room, message) => {
    if (message.workRoundId !== undefined) return message.workRoundId
    if (room?.roomType !== 'studio') return null
    return roundAt(room.id, message.ts) ?? room.activeRoundId ?? room.lastRoundId ?? null
  }

  const appendMessage = (roomId, message) => {
    const room = readRoom(roomId)
    const workRoundId = roundForMessage(room, message)
    const stored = persistMessage(
      {
        ...message,
        ...(workRoundId === null ? {} : { workRoundId }),
        id: randomUUID(),
        roomId,
        seq: nextSeq(),
        ts: Date.now(),
      },
      { transcript: room?.demo !== true },
    )
    emit('msg', stored, stored.seq)
    return stored
  }

  const upsertMessage = message => {
    const row = db.prepare('SELECT seq, room_id, work_round_id FROM messages WHERE id = ?').get(message.id)
    if (row !== undefined) {
      if (row.room_id !== message.roomId) return null
      // 更新一条已经落库的消息时保留它原来的轮次；迟到的补丁不能把它挪到新轮。
      const workRoundId = message.workRoundId !== undefined
        ? message.workRoundId
        : (row.work_round_id ?? roundForMessage(readRoom(message.roomId), message))
      const updated = {
        ...message,
        ...(workRoundId === null ? {} : { workRoundId }),
        seq: row.seq,
      }
      db.prepare('UPDATE messages SET work_round_id = ?, payload = ? WHERE id = ?')
        .run(workRoundIdOf(updated), JSON.stringify(updated), updated.id)
      if (message.meta?.final === true) {
        try { appendTranscript(readRoom(message.roomId) ?? message.roomId, updated) } catch {}
      }
      emit('msg.patch', updated, updated.seq)
      return updated
    }
    const room = readRoom(message.roomId)
    const workRoundId = roundForMessage(room, message)
    const stored = persistMessage({
      ...message,
      ...(workRoundId === null ? {} : { workRoundId }),
      seq: nextSeq(),
    })
    emit('msg', stored, stored.seq)
    return stored
  }

  const appendEvent = (roomId, type, payload = {}) => {
    const row = insertEvent(roomId, { type, payload })
    mirrorEvent(roomId, row)
    return row
  }

  const readEvents = (roomId, limit = 200) => db.prepare(
    'SELECT id, seq, room_id, type, payload, at FROM room_event WHERE room_id = ? ORDER BY seq DESC LIMIT ?',
  ).all(roomId, limit).reverse().map(row => ({
    id: row.id,
    roomId: row.room_id,
    type: row.type,
    payload: JSON.parse(row.payload),
    at: row.at,
  }))

  const recoverEvent = event => {
    if (typeof event?.id !== 'string' || event.id === '' || typeof event?.roomId !== 'string') return null
    if (db.prepare('SELECT 1 FROM room_event WHERE id = ?').get(event.id) !== undefined) return null
    const result = db.prepare('INSERT OR IGNORE INTO room_event (id, room_id, type, payload, idempotency_key, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        event.id, event.roomId, String(event.type ?? ''), JSON.stringify(event.payload ?? {}),
        event.idempotencyKey ?? null, event.at ?? Date.now(),
      )
    return Number(result.changes) > 0 ? event : null
  }

  const pruneActivityMessages = (roomId, { keep = 2000 } = {}) => {
    const size = Math.max(0, Number(keep) || 0)
    const rows = db.prepare("SELECT id, payload FROM messages WHERE room_id = ? ORDER BY seq DESC").all(roomId)
    const old = rows
      .filter(row => JSON.parse(row.payload).kind === 'activity')
      .slice(size)
      .map(row => row.id)
    for (const id of old) db.prepare('DELETE FROM messages WHERE id = ?').run(id)
    return old.length
  }

  const pruneEvents = (roomId, { keep = 5000 } = {}) => {
    const size = Math.max(0, Number(keep) || 0)
    return Number(db.prepare(
      'DELETE FROM room_event WHERE room_id = ? AND seq NOT IN (SELECT seq FROM room_event WHERE room_id = ? ORDER BY seq DESC LIMIT ?)',
    ).run(roomId, roomId, size).changes)
  }

  const recoverMessage = message => {
    if (typeof message?.id !== 'string' || message.id === '' || typeof message?.roomId !== 'string') return null
    if (readRoom(message.roomId) === null) return null
    if (db.prepare('SELECT 1 FROM messages WHERE id = ?').get(message.id) !== undefined) return null
    const seqFree = Number.isInteger(message.seq) &&
      db.prepare('SELECT 1 FROM messages WHERE seq = ?').get(message.seq) === undefined
    const stored = { ...message, seq: seqFree ? message.seq : nextSeq() }
    db.prepare('INSERT INTO messages (seq, id, room_id, work_round_id, payload) VALUES (?, ?, ?, ?, ?)')
      .run(stored.seq, stored.id, stored.roomId, workRoundIdOf(stored), JSON.stringify(stored))
    return stored
  }

  return {
    nextSeq,
    readMessages,
    readRecentMessages,
    maxMessageSeq,
    readEvidence,
    readMessagesSince,
    persistMessage,
    appendMessage,
    upsertMessage,
    appendEvent,
    readEvents,
    recoverEvent,
    recoverMessage,
    pruneActivityMessages,
    pruneEvents,
  }
}
