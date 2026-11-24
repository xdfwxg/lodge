import { randomUUID } from 'node:crypto'
import * as log from '../log.js'
import { appendTranscript, writeEvidence } from '../room-repo.js'
import { workRoundIdOf } from '../../../shared/work-round.js'
import { clipText, searchTerms } from '../message-search.js'

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

  // 房间历史索引：只收人看得到的文字，工具活动不入库。
  const indexable = message => (
    message?.kind !== 'activity' &&
    typeof message?.text === 'string' &&
    message.text.trim() !== ''
  )
  const indexMessage = message => {
    if (!indexable(message)) return
    db.prepare('INSERT INTO message_fts (text, room_id, message_id, author_id, ts) VALUES (?, ?, ?, ?, ?)')
      .run(clipText(message.text), message.roomId, message.id, String(message.authorId ?? ''), Number(message.ts) || Date.now())
  }
  const unindexMessage = id => db.prepare('DELETE FROM message_fts WHERE message_id = ?').run(id)

  // 只读检索：按房间限定，返回最近的片段；不做跨房间召回。
  const searchMessages = (roomId, query, { limit = 8, before = null } = {}) => {
    const terms = searchTerms(query)
    if (terms.length === 0) return []
    const cap = Math.max(1, Math.min(20, Number(limit) || 8))
    const long = terms.filter(term => [...term].length >= 3)
    const short = terms.filter(term => [...term].length < 3)
    if (long.length === 0) {
      const where = short.map(() => 'text LIKE ?').join(' OR ')
      const args = [roomId, ...short.map(term => `%${term}%`)]
      const beforeSql = before === null ? '' : ' AND ts < ?'
      if (before !== null) args.push(before)
      args.push(cap)
      return db.prepare(`SELECT message_id AS id, author_id AS authorId, ts, text FROM message_fts WHERE room_id = ? AND (${where})${beforeSql} ORDER BY ts DESC LIMIT ?`).all(...args)
    }
    const args = [long.map(term => `"${term.replaceAll('"', '')}"`).join(' OR '), roomId]
    const beforeSql = before === null ? '' : ' AND ts < ?'
    if (before !== null) args.push(before)
    args.push(cap)
    return db.prepare(`SELECT message_id AS id, author_id AS authorId, ts, text FROM message_fts WHERE message_fts MATCH ? AND room_id = ?${beforeSql} ORDER BY rank LIMIT ?`).all(...args)
  }

  const readMessage = (roomId, id) => {
    const row = db.prepare('SELECT payload FROM messages WHERE id = ? AND room_id = ?').get(id, roomId)
    return row === undefined ? null : JSON.parse(row.payload)
  }

  // 基座幂等键直接查索引，不再为了对一条消息把整间房读进内存。
  const findMessageByMeta = (roomId, field, value) => {
    if (!['baseId', 'sendId'].includes(field)) return null
    if (typeof value !== 'string' || value === '') return null
    const row = db.prepare(
      `SELECT payload FROM messages WHERE room_id = ? AND json_extract(payload, '$.meta.${field}') = ? ORDER BY seq DESC LIMIT 1`,
    ).get(roomId, value)
    return row === undefined ? null : JSON.parse(row.payload)
  }
  const findMessageByBaseId = (roomId, baseId) => findMessageByMeta(roomId, 'baseId', baseId)
  const findMessageBySendId = (roomId, sendId) => findMessageByMeta(roomId, 'sendId', sendId)

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
      // transcript 与证据是恢复日志和可读镜像，不是业务真相；写不进去只记一笔，消息仍要落库。
      try {
        appendTranscript(room ?? message.roomId, message)
        if (message.kind === 'evidence') writeEvidence(room ?? message.roomId, message)
      } catch (error) {
        log.warn(`message mirror failed: ${message.roomId} ${error?.message ?? error}`)
      }
    }
    // 消息与全文索引同一个保存点：不会留下“有消息、搜不到”的半份历史。
    db.exec('SAVEPOINT message_write')
    try {
      db.prepare('INSERT INTO messages (seq, id, room_id, work_round_id, payload) VALUES (?, ?, ?, ?, ?)')
        .run(message.seq, message.id, message.roomId, workRoundIdOf(message), JSON.stringify(message))
      indexMessage(message)
      db.exec('RELEASE message_write')
    } catch (error) {
      db.exec('ROLLBACK TO message_write')
      db.exec('RELEASE message_write')
      throw error
    }
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
      unindexMessage(updated.id)
      indexMessage(updated)
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
    // 从 transcript 补回来的消息也要能搜到，否则恢复后的历史是半份。
    db.exec('SAVEPOINT message_recover')
    try {
      db.prepare('INSERT INTO messages (seq, id, room_id, work_round_id, payload) VALUES (?, ?, ?, ?, ?)')
        .run(stored.seq, stored.id, stored.roomId, workRoundIdOf(stored), JSON.stringify(stored))
      indexMessage(stored)
      db.exec('RELEASE message_recover')
    } catch (error) {
      db.exec('ROLLBACK TO message_recover')
      db.exec('RELEASE message_recover')
      throw error
    }
    return stored
  }

  return {
    nextSeq,
    readMessage,
    findMessageByBaseId,
    findMessageBySendId,
    readMessages,
    readRecentMessages,
    maxMessageSeq,
    readEvidence,
    readMessagesSince,
    persistMessage,
    appendMessage,
    upsertMessage,
    searchMessages,
    appendEvent,
    readEvents,
    recoverEvent,
    recoverMessage,
    pruneActivityMessages,
    pruneEvents,
  }
}
