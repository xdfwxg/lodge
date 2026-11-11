import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { appendEventLog, appendTranscript, writeEvidence } from './room-repo.js'

export const createStore = ({ dataDir, emit = () => {} }) => {
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(join(dataDir, 'crew.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS room (id TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, room_id TEXT NOT NULL, payload TEXT NOT NULL);
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
  const roomColumns = db.prepare('PRAGMA table_info(room)').all()
  if (!roomColumns.some(column => column.name === 'version')) {
    db.exec('ALTER TABLE room ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
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
  const readMessagesSince = since => db.prepare('SELECT payload FROM messages WHERE seq > ? ORDER BY seq').all(since).map(row => JSON.parse(row.payload))
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

  const readEvents = (roomId, limit = 200) => db.prepare(
    'SELECT id, room_id, type, payload, at FROM room_event WHERE room_id = ? ORDER BY seq DESC LIMIT ?',
  ).all(roomId, limit).reverse().map(row => ({
    id: row.id,
    roomId: row.room_id,
    type: row.type,
    payload: JSON.parse(row.payload),
    at: row.at,
  }))

  // transcript.jsonl 先写，SQLite 后写：jsonl 是持久日志，库是索引，可从日志重建。
  // 演示种子只进 SQLite，不写目标仓库，避免样例数据污染用户仓库。
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
      emit('msg.patch', updated, updated.seq)
      return updated
    }
    const stored = persistMessage({ ...message, seq: nextSeq() })
    emit('msg', stored, stored.seq)
    return stored
  }

  return {
    db,
    readRoom,
    writeRoom,
    updateRoom,
    readRooms,
    readMessages,
    readMessagesSince,
    nextSeq,
    persistMessage,
    appendMessage,
    upsertMessage,
    appendEvent,
    readEvents,
  }
}
