import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { evidenceDigest, evidenceEntryFromMessage } from './evidence-ledger.js'
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
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS evidence_room ON evidence(room_id, seq);
  `)
  const roomColumns = db.prepare('PRAGMA table_info(room)').all()
  if (!roomColumns.some(column => column.name === 'version')) {
    db.exec('ALTER TABLE room ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
  }

  // 旧聊天室曾借用 stages/chats 分散字段；读路径迁到 room.chat，下一次写入自然落盘。
  const upgradeRoom = room => {
    // 旧房间的执行席位显示名迁移；只改展示名，不改席位 id 和权限。
    if (Array.isArray(room?.seatSpecs)) {
      room.seatSpecs = room.seatSpecs.map(seat => (
        seat?.role === 'worker' && seat.name === '执行者'
          ? { ...seat, name: '执行官', prompt: String(seat.prompt ?? '').replaceAll('执行者', '执行官') }
          : seat
      ))
    }
    if (room?.roomType !== 'chat') {
      if (room.engine === undefined) room.engine = 'delivery'
      if (room?.closure === undefined) {
        room.closure = room.state === 'complete'
          ? 'signed'
          : Array.isArray(room.stages) && room.stages.some(stage => stage.state === 'active')
            ? 'executing'
            : 'open'
      }
      if (room?.verificationMode === undefined) {
        room.verificationMode = (room.verifiers?.length ?? 0) > 0 ? 'hybrid' : 'human'
      }
      if (room.verifierPolicy === undefined) room.verifierPolicy = 'all'
      if (room.shadowReview === undefined) room.shadowReview = false
      if (room.parentRoomId === undefined) room.parentRoomId = null
      if (room.depth === undefined) room.depth = 0
      if (!Array.isArray(room.childRoomIds)) room.childRoomIds = []
      return room
    }
    if (room.engine === undefined) room.engine = 'chat'
    delete room.closure
    delete room.verificationMode
    if (room.chat === undefined) {
      const running = room.chatRunning === true
      const phase = running
        ? (room.chatPhase === 'summarizing' ? 'summarizing' : 'discussing')
        : room.state === 'complete'
          ? 'awaiting_decision'
          : (room.chatTurns ?? 0) >= 6 ? 'awaiting_decision' : 'discussing'
      room.chat = {
        round: Number.isInteger(room.chatRound) && room.chatRound > 0 ? room.chatRound : 1,
        phase,
        turns: room.chatTurns ?? 0,
        conclusionId: typeof room.chatConclusionId === 'string' ? room.chatConclusionId : null,
        accepted: room.state === 'complete',
        running,
        speaker: typeof room.chatSpeaker === 'string' ? room.chatSpeaker : '',
        note: typeof room.chatNote === 'string' ? room.chatNote : '',
      }
    }
    delete room.stages
    delete room.chatRound
    delete room.chatTurns
    delete room.chatRunning
    delete room.chatPhase
    delete room.chatSpeaker
    delete room.chatNote
    delete room.chatConclusionId
    return room
  }

  const readRoom = id => {
    const row = db.prepare('SELECT payload, version FROM room WHERE id = ?').get(id)
    if (row === undefined) return null
    const room = upgradeRoom(JSON.parse(row.payload))
    // 读路径只做内存迁移；升级后的聊天室在下一次 updateRoom 时才写回。
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
    .map(row => ({ ...upgradeRoom(JSON.parse(row.payload)), version: row.version }))
  const readMessages = roomId => db.prepare('SELECT payload FROM messages WHERE room_id = ? ORDER BY seq').all(roomId).map(row => JSON.parse(row.payload))
  // 证据账本只追加：命令证据和人工产物证据进入账本，执行席位的自述回合留在消息流。
  const appendEvidenceFromMessage = message => {
    const base = evidenceEntryFromMessage(message)
    if (base === null) return null
    const digest = evidenceDigest(base)
    const entry = { ...base, digest }
    db.prepare('INSERT OR IGNORE INTO evidence (id, room_id, seq, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(entry.id, entry.roomId, entry.seq, JSON.stringify(entry), entry.at)
    return entry
  }

  const readEvidenceRows = roomId => db.prepare('SELECT payload FROM evidence WHERE room_id = ? ORDER BY seq').all(roomId)
    .map(row => JSON.parse(row.payload))

  const readEvidence = roomId => {
    let rows = readEvidenceRows(roomId)
    if (rows.length === 0) {
      // 旧房间第一次读账本时，从已有命令/人工证据消息补账；只追加，不改消息。
      for (const message of readMessages(roomId)) appendEvidenceFromMessage(message)
      rows = readEvidenceRows(roomId)
    }
    return rows
  }
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
      const room = upgradeRoom(JSON.parse(row.payload))
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
    'SELECT id, seq, room_id, type, payload, at FROM room_event WHERE room_id = ? ORDER BY seq DESC LIMIT ?',
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
    appendEvidenceFromMessage(stored)
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
    readEvidence,
    appendEvidenceFromMessage,
    nextSeq,
    persistMessage,
    appendMessage,
    upsertMessage,
    appendEvent,
    readEvents,
  }
}
