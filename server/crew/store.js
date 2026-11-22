import * as log from './log.js'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { appendEventLog } from './room-repo.js'
import { ROUND_FIELDS } from '../../shared/work-round.js'
import { ROUND_STATUS } from '../../shared/states.js'
import { createWorkStore } from './store/work.js'
import { createRoundLifecycleStore, createRoundStore } from './store/rounds.js'
import { createProjectStore } from './store/projects.js'
import { createAssignmentStore } from './store/assignments.js'
import { createTimelineStore } from './store/timeline.js'

export const SCHEMA_VERSION = 7

// 版本迁移只做向前的一步；没有迁移路径的旧版本仍要求重置，避免猜数据。
const LEGACY_ROUND_FIELDS = ['mergeResolved', 'advisorShadow', 'previews', 'reviewRetriedAt', 'stageDiagnostics']

const MIGRATIONS = {
  4: db => db.exec('CREATE INDEX IF NOT EXISTS messages_room_seq ON messages(room_id, seq)'),
  // 旧版把轮次字段写在房间 payload 里；工作室房间的轮次字段全部删掉，
  // 聊天室的轮次概念不同，只清这五个确实属于工作室轮次的字段。
  5: db => {
    const update = db.prepare('UPDATE room SET payload = ? WHERE id = ?')
    for (const row of db.prepare('SELECT id, payload FROM room').all()) {
      const room = JSON.parse(row.payload)
      const fields = room.roomType === 'studio' && (room.activeRoundId ?? room.lastRoundId ?? null) !== null
        ? ROUND_FIELDS
        : LEGACY_ROUND_FIELDS
      for (const field of fields) delete room[field]
      update.run(JSON.stringify(room), row.id)
    }
  },
  // 旧版用“当前轮”给到达的消息归轮，迟到的上一轮消息会落进下一轮；按消息时间重新归一次。
  6: db => {
    const update = db.prepare('UPDATE messages SET work_round_id = ? WHERE id = ?')
    for (const roomRow of db.prepare('SELECT id, payload FROM room').all()) {
      const room = JSON.parse(roomRow.payload)
      if (room.roomType !== 'studio') continue
      const rounds = db.prepare('SELECT id, payload FROM work_round WHERE room_id = ? ORDER BY ordinal').all(room.id)
        .map(row => ({ id: row.id, startedAt: JSON.parse(row.payload).startedAt }))
        .filter(round => Number.isFinite(round.startedAt))
      if (rounds.length === 0) continue
      for (const messageRow of db.prepare('SELECT id, payload FROM messages WHERE room_id = ?').all(room.id)) {
        const message = JSON.parse(messageRow.payload)
        if (!Number.isFinite(message.ts)) continue
        let chosen
        for (const round of rounds) if (message.ts >= round.startedAt) chosen = round.id
        if (chosen !== undefined) update.run(chosen, messageRow.id)
      }
    }
  },
}

const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS room (id TEXT PRIMARY KEY, payload TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS messages (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    room_id TEXT NOT NULL,
    work_round_id TEXT,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_room_round ON messages(room_id, work_round_id, seq);
  CREATE INDEX IF NOT EXISTS messages_room_seq ON messages(room_id, seq);
  CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS assignment (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    work_round_id TEXT,
    stage INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS assignment_room ON assignment(room_id, created_at);
  CREATE INDEX IF NOT EXISTS assignment_round_stage ON assignment(room_id, work_round_id, stage, created_at);
  CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS project_updated ON project(updated_at);
  CREATE TABLE IF NOT EXISTS work_round (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    project_id TEXT,
    ordinal INTEGER NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS work_round_room ON work_round(room_id, ordinal);
  CREATE INDEX IF NOT EXISTS work_round_project ON work_round(project_id, updated_at);
  CREATE UNIQUE INDEX IF NOT EXISTS work_round_one_open ON work_round(room_id) WHERE status IN ('planning', 'active');
  CREATE TABLE IF NOT EXISTS room_event (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    room_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    idempotency_key TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS room_event_room ON room_event(room_id, seq);
  CREATE UNIQUE INDEX IF NOT EXISTS room_event_idempotency ON room_event(room_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  CREATE TABLE IF NOT EXISTS work_item (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    room_id TEXT NOT NULL,
    round_id TEXT,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    available_at INTEGER NOT NULL,
    lease_until INTEGER,
    dedupe_key TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS work_item_dedupe ON work_item(room_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS work_item_due ON work_item(status, available_at);
  CREATE INDEX IF NOT EXISTS work_item_room ON work_item(room_id, status, available_at);
  PRAGMA user_version = ${SCHEMA_VERSION};
`

export const createStore = ({ dataDir, emit = () => {} }) => {
  mkdirSync(dataDir, { recursive: true })
  const fresh = !existsSync(join(dataDir, 'crew.db'))
  const db = new DatabaseSync(join(dataDir, 'crew.db'))
  if (!fresh) {
    const row = db.prepare('PRAGMA user_version').get()
    const version = Number(row?.user_version ?? 0)
    if (version > SCHEMA_VERSION) {
      db.close()
      throw new Error(`数据库版本 ${version} 高于当前模型 ${SCHEMA_VERSION}；请升级应用`)
    }
    if (version < SCHEMA_VERSION) {
      if (version < 4) {
        db.close()
        throw new Error(`数据库版本 ${version} 没有迁移路径；运行 npm run data:reset 重建本地数据`)
      }
      db.exec('BEGIN IMMEDIATE')
      try {
        for (let at = version; at < SCHEMA_VERSION; at += 1) MIGRATIONS[at]?.(db)
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        db.close()
        throw error
      }
    }
  }
  db.exec(SCHEMA_SQL)
  const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check
  if (integrity !== 'ok') throw new Error(`数据库损坏：${integrity ?? '未知错误'}`)

  const work = createWorkStore({ db })
  const rounds = createRoundStore({ db })
  const projects = createProjectStore({ db })

  const backup = file => {
    db.exec(`VACUUM INTO '${String(file).replaceAll("'", "''")}'`)
    return file
  }

  const readProfile = () => {
    const row = db.prepare('SELECT payload FROM profile WHERE id = 1').get()
    if (row === undefined) return { name: '', avatar: null, updatedAt: null }
    try {
      const value = JSON.parse(row.payload)
      return {
        name: typeof value?.name === 'string' ? value.name : '',
        avatar: typeof value?.avatar === 'string' ? value.avatar : null,
        updatedAt: Number.isFinite(value?.updatedAt) ? value.updatedAt : null,
      }
    } catch {
      return { name: '', avatar: null, updatedAt: null }
    }
  }

  const writeProfile = value => {
    const profile = {
      name: typeof value?.name === 'string' ? value.name : '',
      avatar: typeof value?.avatar === 'string' ? value.avatar : null,
      updatedAt: Number.isFinite(value?.updatedAt) ? value.updatedAt : Date.now(),
    }
    db.prepare('INSERT INTO profile (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload')
      .run(JSON.stringify(profile))
    return profile
  }

  // 房间是长期容器；当前轮次是读取时组合出来的视图，不复制进 room payload。
  function composeRoomView(room) {
    const roundId = room.activeRoundId ?? room.lastRoundId
    if (typeof roundId !== 'string' || roundId === '') return room
    const workRound = rounds.readWorkRound(roundId, room.id)
    if (workRound === null) return room
    const view = { ...room }
    for (const field of ROUND_FIELDS) {
      if (workRound[field] !== undefined) view[field] = workRound[field]
    }
    view.workRound = workRound
    view.workRoundId = workRound.id
    return view
  }

  const readRoom = id => {
    const row = db.prepare('SELECT payload, version FROM room WHERE id = ?').get(id)
    if (row === undefined) return null
    const room = JSON.parse(row.payload)
    room.version = row.version
    return composeRoomView(room)
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
    .map(row => composeRoomView({ ...JSON.parse(row.payload), version: row.version }))

  const roundIdForRead = roomId => {
    const room = readRoom(roomId)
    if (room === null) return null
    return room.activeRoundId ?? room.lastRoundId ?? null
  }

  function applyRoundPatch(roundId, patch) {
    const row = db.prepare('SELECT payload, version FROM work_round WHERE id = ?').get(roundId)
    if (row === undefined) return null
    const round = JSON.parse(row.payload)
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) round[key] = value
    }
    const version = Number(row.version) + 1
    round.version = version
    round.updatedAt = Date.now()
    const updated = db.prepare(
      'UPDATE work_round SET project_id = ?, ordinal = ?, status = ?, payload = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?',
    ).run(
      round.projectId ?? null, round.ordinal ?? 1, round.status ?? ROUND_STATUS.planning,
      JSON.stringify(round), version, round.updatedAt, roundId, row.version,
    )
    return Number(updated.changes) > 0 ? round : null
  }

  const insertEvent = (roomId, event) => {
    const row = {
      id: randomUUID(),
      roomId,
      type: String(event.type),
      payload: JSON.stringify(event.payload ?? {}),
      idempotencyKey: event.idempotencyKey ?? null,
      at: event.at ?? Date.now(),
    }
    db.prepare('INSERT INTO room_event (id, room_id, type, payload, idempotency_key, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.roomId, row.type, row.payload, row.idempotencyKey, row.at)
    return row
  }

  const mirrorEvent = (roomId, row) => {
    try {
      const room = readRoom(roomId)
      if (room === null || room.demo === true || typeof room.repoPath !== 'string' || room.repoPath === '') return
      appendEventLog(room, { id: row.id, roomId, type: row.type, payload: JSON.parse(row.payload), at: row.at })
    } catch (error) {
      log.warn(`room event mirror failed: ${roomId} ${error?.message ?? error}`)
    }
  }

  const timeline = createTimelineStore({ db, emit, readRoom, roundIdForRead, insertEvent, mirrorEvent })
  const roundLifecycle = createRoundLifecycleStore({
    db,
    readRoom,
    writeWorkRound: rounds.writeWorkRound,
    readWorkRound: rounds.readWorkRound,
    insertEvent,
    mirrorEvent,
    persistMessage: message => {
      const room = readRoom(message.roomId)
      return timeline.persistMessage(
        { ...message, id: randomUUID(), seq: timeline.nextSeq(), ts: Date.now() },
        { transcript: room?.demo !== true },
      )
    },
  })
  const assignments = createAssignmentStore({ db, readRoom, roundIdForRead })

  // 房间写入：只认房间自己的字段；轮次字段必须走 updateRound，别再隐式改到旧轮。
  const updateRoom = (id, mutate) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare('SELECT payload, version FROM room WHERE id = ?').get(id)
      if (row === undefined) {
        db.exec('ROLLBACK')
        return null
      }
      const stored = JSON.parse(row.payload)
      const before = structuredClone(stored)
      const change = mutate(stored)
      if (change === null || change === undefined || change === false) {
        db.exec('ROLLBACK')
        return null
      }
      for (const field of ROUND_FIELDS) {
        if (JSON.stringify(stored[field]) !== JSON.stringify(before[field])) {
          throw new Error(`轮次字段 ${field} 要用 updateRound 写`)
        }
      }
      const version = Number(row.version) + 1
      stored.version = version
      db.prepare('UPDATE room SET payload = ?, version = ? WHERE id = ? AND version = ?')
        .run(JSON.stringify(stored), version, id, row.version)
      const events = []
      for (const event of change.events ?? []) events.push(insertEvent(id, event))
      db.exec('COMMIT')
      for (const event of events) mirrorEvent(id, event)
      return composeRoomView(stored)
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  // 当前轮写入：mutate 拿到房间和轮次组合视图；轮次字段写回 work_round，房间字段写回 room。
  const updateRound = (id, mutate) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare('SELECT payload, version FROM room WHERE id = ?').get(id)
      if (row === undefined) {
        db.exec('ROLLBACK')
        return null
      }
      const raw = JSON.parse(row.payload)
      raw.version = row.version
      const view = composeRoomView(raw)
      const before = structuredClone(view)
      const change = mutate(view)
      if (change === null || change === undefined || change === false) {
        db.exec('ROLLBACK')
        return null
      }

      if (view.workRound !== undefined) {
        const roundPatch = {}
        for (const field of ROUND_FIELDS) {
          if (JSON.stringify(view[field]) !== JSON.stringify(before[field])) roundPatch[field] = view[field]
        }
        if (Object.keys(roundPatch).length > 0) {
          if (raw.activeRoundId === undefined || raw.activeRoundId === null) {
            throw new Error('已结束的轮次不能再改')
          }
          const updatedRound = applyRoundPatch(view.workRound.id, roundPatch)
          if (updatedRound === null) {
            db.exec('ROLLBACK')
            return null
          }
        }
      }

      const storedRoom = { ...view }
      if (view.workRound !== undefined) {
        for (const field of ROUND_FIELDS) delete storedRoom[field]
        delete storedRoom.workRound
        delete storedRoom.workRoundId
      }
      const version = Number(row.version) + 1
      storedRoom.version = version
      db.prepare('UPDATE room SET payload = ?, version = ? WHERE id = ? AND version = ?')
        .run(JSON.stringify(storedRoom), version, id, row.version)
      const events = []
      for (const event of change.events ?? []) events.push(insertEvent(id, event))
      db.exec('COMMIT')
      for (const event of events) mirrorEvent(id, event)
      return composeRoomView(storedRoom)
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const deleteRoom = id => {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('DELETE FROM messages WHERE room_id = ?').run(id)
      db.prepare('DELETE FROM assignment WHERE room_id = ?').run(id)
      db.prepare('DELETE FROM work_round WHERE room_id = ?').run(id)
      db.prepare('DELETE FROM room_event WHERE room_id = ?').run(id)
      db.prepare('DELETE FROM work_item WHERE room_id = ?').run(id)
      const result = db.prepare('DELETE FROM room WHERE id = ?').run(id)
      db.exec('COMMIT')
      return Number(result.changes) > 0
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return {
    db,
    fresh,
    readRoom,
    readProfile,
    writeProfile,
    backup,
    writeRoom,
    updateRoom,
    updateRound,
    readRooms,
    deleteRoom,
    ...rounds,
    ...roundLifecycle,
    ...projects,
    ...assignments,
    ...timeline,
    ...work,
  }
}
