import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { appendEventLog, appendTranscript, writeEvidence } from './room-repo.js'

const SCHEMA_VERSION = 1

export const createStore = ({ dataDir, emit = () => {} }) => {
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(join(dataDir, 'crew.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS room (id TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, room_id TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assignment (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      stage INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assignment_room ON assignment(room_id, created_at);
    CREATE INDEX IF NOT EXISTS assignment_room_stage ON assignment(room_id, stage, created_at);
    CREATE TABLE IF NOT EXISTS room_event (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      room_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS room_event_room ON room_event(room_id, seq);
  `)
  const schemaVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  if (schemaVersion > SCHEMA_VERSION) throw new Error(`数据库版本 ${schemaVersion} 比当前 Lodge 新，请先升级 Lodge`)
  if (schemaVersion < 1) {
    // v1：旧版本的全局成员表已经并入 room.members；房间增加 version 列。
    db.exec('DROP TABLE IF EXISTS member')
    const roomColumns = db.prepare('PRAGMA table_info(room)').all()
    if (!roomColumns.some(column => column.name === 'version')) {
      db.exec('ALTER TABLE room ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
    }
    db.exec('PRAGMA user_version = 1')
  }
  const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check
  if (integrity !== 'ok') throw new Error(`数据库损坏：${integrity ?? '未知错误'}`)


  // 迁移或升级前留一份一致快照；VACUUM INTO 会包含 WAL 里的已提交数据。
  const backup = file => {
    db.exec(`VACUUM INTO '${String(file).replaceAll("'", "''")}'`)
    return file
  }

  const readRoom = id => {
    const row = db.prepare('SELECT payload, version FROM room WHERE id = ?').get(id)
    if (row === undefined) return null
    const room = JSON.parse(row.payload)
    room.version = row.version
    return room
  }
  // 只用于建房与种子；已有房间的状态变更走 updateRoom，避免丢更新。
  const writeRoom = room => {
    const version = Number(room.version ?? 1)
    room.version = version
    db.prepare(
      'INSERT INTO room (id, payload, version) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, version = excluded.version',
    ).run(room.id, JSON.stringify(room), version)
    return room
  }
  const readRooms = () => db.prepare("SELECT payload, version FROM room WHERE id <> 'dispatch' ORDER BY rowid").all()
    .map(row => ({ ...JSON.parse(row.payload), version: row.version }))
  const readMessages = roomId => db.prepare('SELECT payload FROM messages WHERE room_id = ? ORDER BY seq').all(roomId).map(row => JSON.parse(row.payload))
  // 展示层只取最近一段；内部迁移和证据仍用 readMessages 读全量。
  const readRecentMessages = (roomId, limit = 5000) => db.prepare(
    'SELECT payload FROM (SELECT seq, payload FROM messages WHERE room_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq',
  ).all(roomId, Math.max(1, Math.min(10000, Number(limit) || 5000))).map(row => JSON.parse(row.payload))
  const maxMessageSeq = roomId => db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE room_id = ?').get(roomId)?.seq ?? 0
  // 证据就是消息流里的命令/人工结果；不再维护单独的账本表与摘要。
  const readEvidence = roomId => readMessages(roomId)
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
  const readMessagesSince = since => db.prepare('SELECT payload FROM messages WHERE seq > ? ORDER BY seq').all(since).map(row => JSON.parse(row.payload))
  const readAssignment = id => {
    const row = db.prepare('SELECT payload FROM assignment WHERE id = ?').get(id)
    return row === undefined ? null : JSON.parse(row.payload)
  }
  const readAssignments = (roomId, { stage = null, status = null, before = null, limit = 500 } = {}) => {
    const where = ['room_id = ?']
    const params = [roomId]
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
    const stored = {
      ...assignment,
      createdAt: assignment.createdAt ?? now,
      updatedAt: assignment.updatedAt ?? now,
    }
    db.prepare(
      'INSERT INTO assignment (id, room_id, stage, status, created_at, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET stage = excluded.stage, status = excluded.status, updated_at = excluded.updated_at, payload = excluded.payload',
    ).run(stored.id, stored.roomId, stored.stageIndex ?? 0, stored.status ?? 'created', stored.createdAt, stored.updatedAt, JSON.stringify(stored))
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
      db.prepare('UPDATE assignment SET stage = ?, status = ?, updated_at = ?, payload = ? WHERE id = ?')
        .run(stored.stageIndex ?? 0, stored.status ?? 'created', stored.updatedAt, JSON.stringify(stored), id)
      db.exec('COMMIT')
      return stored
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  const deleteAssignments = roomId => Number(db.prepare('DELETE FROM assignment WHERE room_id = ?').run(roomId).changes)

  const nextSeq = () => Number(db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages').get().next)

  const insertEvent = (roomId, event) => {
    const row = {
      id: randomUUID(),
      roomId,
      type: String(event.type),
      payload: JSON.stringify(event.payload ?? {}),
      at: event.at ?? Date.now(),
    }
    db.prepare('INSERT INTO room_event (id, room_id, type, payload, at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.roomId, row.type, row.payload, row.at)
    return row
  }

  // 事件镜像失败不能反转已提交的业务动作；连读取失败也只记录，不抛回业务层。
  const mirrorEvent = (roomId, row) => {
    try {
      const room = readRoom(roomId)
      if (room === null || room.demo === true || typeof room.repoPath !== 'string' || room.repoPath === '') return
      appendEventLog(room, { id: row.id, roomId, type: row.type, payload: JSON.parse(row.payload), at: row.at })
    } catch (error) {
      console.warn(`room event mirror failed: ${roomId} ${error?.message ?? error}`)
    }
  }

  // 读-改-写放在同一个 IMMEDIATE 事务里；mutate 返回 null 表示放弃本次修改。
  const updateRoom = (id, mutate) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare('SELECT payload, version FROM room WHERE id = ?').get(id)
      if (row === undefined) {
        db.exec('ROLLBACK')
        return null
      }
      const room = JSON.parse(row.payload)
      const change = mutate(room)
      if (change === null || change === undefined || change === false) {
        db.exec('ROLLBACK')
        return null
      }
      const version = Number(row.version) + 1
      room.version = version
      db.prepare('UPDATE room SET payload = ?, version = ? WHERE id = ? AND version = ?')
        .run(JSON.stringify(room), version, id, row.version)
      const events = []
      for (const event of change.events ?? []) events.push(insertEvent(id, event))
      db.exec('COMMIT')
      for (const event of events) mirrorEvent(id, event)
      return room
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const appendEvent = (roomId, type, payload = {}) => {
    const row = insertEvent(roomId, { type, payload })
    mirrorEvent(roomId, row)
    return row
  }

  // 房间记录删除后，消息和事件不能留下孤儿行；工作区文件不在这里处理。
  const deleteRoom = id => {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM messages WHERE room_id = ?').run(id)
      db.prepare('DELETE FROM assignment WHERE room_id = ?').run(id)
      db.prepare('DELETE FROM room_event WHERE room_id = ?').run(id)
      const result = db.prepare('DELETE FROM room WHERE id = ?').run(id)
      db.exec('COMMIT')
      return Number(result.changes) > 0
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
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

  // transcript.jsonl 先写，SQLite 后写；库是真相，jsonl 是崩溃恢复日志与可读镜像。
  // 示例种子只进 SQLite，不写目标仓库，避免样例数据污染用户仓库。
  const persistMessage = (message, { transcript = true } = {}) => {
    const room = readRoom(message.roomId)
    if (message.kind === 'evidence' && transcript) {
      message.meta = { ...message.meta, evidenceRef: `evidence/${message.id}.json` }
    }
    if (transcript) {
      appendTranscript(room ?? message.roomId, message)
      if (message.kind === 'evidence') writeEvidence(room ?? message.roomId, message)
    }
    db.prepare('INSERT INTO messages (seq, id, room_id, payload) VALUES (?, ?, ?, ?)')
      .run(message.seq, message.id, message.roomId, JSON.stringify(message))
    return message
  }

  const appendMessage = (roomId, message) => {
    const room = readRoom(roomId)
    const stored = persistMessage(
      { ...message, id: randomUUID(), roomId, seq: nextSeq(), ts: Date.now() },
      { transcript: room?.demo !== true },
    )
    emit('msg', stored, stored.seq)
    return stored
  }

  const upsertMessage = message => {
    const row = db.prepare('SELECT seq FROM messages WHERE id = ?').get(message.id)
    if (row !== undefined) {
      const updated = { ...message, seq: row.seq }
      db.prepare('UPDATE messages SET payload = ? WHERE id = ?').run(JSON.stringify(updated), updated.id)
      // 流式消息只在收口时追加一次最终版本，让 transcript 可读；库仍是真相。
      if (message.meta?.final === true) {
        try { appendTranscript(readRoom(message.roomId) ?? message.roomId, updated) } catch {}
      }
      emit('msg.patch', updated, updated.seq)
      return updated
    }
    const stored = persistMessage({ ...message, seq: nextSeq() })
    emit('msg', stored, stored.seq)
    return stored
  }

  // 崩溃恢复只补日志里有、库里没有的消息；已有消息永远以库为准。
  const recoverMessage = message => {
    if (typeof message?.id !== 'string' || message.id === '' || typeof message?.roomId !== 'string') return null
    if (db.prepare('SELECT 1 FROM messages WHERE id = ?').get(message.id) !== undefined) return null
    const seqFree = Number.isInteger(message.seq) &&
      db.prepare('SELECT 1 FROM messages WHERE seq = ?').get(message.seq) === undefined
    const stored = { ...message, seq: seqFree ? message.seq : nextSeq() }
    db.prepare('INSERT INTO messages (seq, id, room_id, payload) VALUES (?, ?, ?, ?)')
      .run(stored.seq, stored.id, stored.roomId, JSON.stringify(stored))
    return stored
  }

  return {
    db,
    readRoom,
    backup,
    writeRoom,
    updateRoom,
    readRooms,
    readAssignment,
    readAssignments,
    writeAssignment,
    updateAssignment,
    deleteAssignments,
    pruneAssignments,
    readMessages,
    readRecentMessages,
    maxMessageSeq,
    readMessagesSince,
    readEvidence,
    nextSeq,
    persistMessage,
    recoverMessage,
    appendMessage,
    upsertMessage,
    appendEvent,
    deleteRoom,
    readEvents,
  }
}
