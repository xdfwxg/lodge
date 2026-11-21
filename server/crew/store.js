import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { appendEventLog, appendTranscript, writeEvidence } from './room-repo.js'

export const SCHEMA_VERSION = 2

export const createStore = ({ dataDir, emit = () => {} }) => {
  mkdirSync(dataDir, { recursive: true })
  const fresh = !existsSync(join(dataDir, 'crew.db'))
  const db = new DatabaseSync(join(dataDir, 'crew.db'))
  if (!fresh) {
    const row = db.prepare('PRAGMA user_version').get()
    const version = Number(row?.user_version ?? 0)
    if (version !== SCHEMA_VERSION) {
      db.close()
      throw new Error(`数据库版本 ${version} 与当前模型 ${SCHEMA_VERSION} 不一致；运行 npm run data:reset 重建本地数据`)
    }
  }
  db.exec(`
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
    CREATE TABLE IF NOT EXISTS room_event (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      room_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS room_event_room ON room_event(room_id, seq);
    CREATE TABLE IF NOT EXISTS room_inbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      room_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_id TEXT,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      claimed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS room_inbox_source ON room_inbox(room_id, source_id) WHERE source_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS room_inbox_pending ON room_inbox(room_id, status, seq);
    CREATE TABLE IF NOT EXISTS room_timer (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS room_timer_due ON room_timer(status, due_at);
    PRAGMA user_version = ${SCHEMA_VERSION};
  `)
  const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check
  if (integrity !== 'ok') throw new Error(`数据库损坏：${integrity ?? '未知错误'}`)

  // 备份前留一份一致快照；VACUUM INTO 会包含 WAL 里的已提交数据。
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
  // 当前用户是全局资料，不是每个房间各存一份称呼。
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

  const writeProject = project => {
    const now = Date.now()
    const stored = {
      ...project,
      createdAt: project.createdAt ?? now,
      updatedAt: project.updatedAt ?? now,
      version: Number(project.version ?? 1),
    }
    db.prepare(
      'INSERT INTO project (id, payload, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at',
    ).run(stored.id, JSON.stringify(stored), stored.version, stored.createdAt, stored.updatedAt)
    return stored
  }
  const readProject = id => {
    const row = db.prepare('SELECT payload, version FROM project WHERE id = ?').get(id)
    if (row === undefined) return null
    return { ...JSON.parse(row.payload), version: row.version }
  }
  const readProjects = () => db.prepare('SELECT payload, version FROM project ORDER BY updated_at DESC').all()
    .map(row => ({ ...JSON.parse(row.payload), version: row.version }))
  const updateProject = (id, mutate) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const row = db.prepare('SELECT payload, version FROM project WHERE id = ?').get(id)
      if (row === undefined) { db.exec('ROLLBACK'); return null }
      const project = JSON.parse(row.payload)
      const change = mutate(project)
      if (change === null || change === undefined || change === false) { db.exec('ROLLBACK'); return null }
      const version = Number(row.version) + 1
      project.version = version
      project.updatedAt = Date.now()
      db.prepare('UPDATE project SET payload = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?')
        .run(JSON.stringify(project), version, project.updatedAt, id, row.version)
      db.exec('COMMIT')
      return project
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const nextWorkRoundOrdinal = roomId => Number(
    db.prepare('SELECT COALESCE(MAX(ordinal), 0) + 1 AS next FROM work_round WHERE room_id = ?').get(roomId)?.next ?? 1,
  )
  const writeWorkRound = round => {
    const now = Date.now()
    const stored = {
      ...round,
      ordinal: Number.isInteger(round.ordinal) ? round.ordinal : nextWorkRoundOrdinal(round.roomId),
      status: typeof round.status === 'string' ? round.status : 'planning',
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
  const readMessages = (roomId, { workRoundId = null } = {}) => {
    const rows = workRoundId === null
      ? db.prepare('SELECT payload FROM messages WHERE room_id = ? ORDER BY seq').all(roomId)
      : db.prepare('SELECT payload FROM messages WHERE room_id = ? AND work_round_id = ? ORDER BY seq').all(roomId, workRoundId)
    return rows.map(row => JSON.parse(row.payload))
  }
  // 展示层只取最近一段；内部迁移和证据仍用 readMessages 读全量。
  const readRecentMessages = (roomId, limit = 5000, { workRoundId = null } = {}) => {
    const size = Math.max(1, Math.min(10000, Number(limit) || 5000))
    const rows = workRoundId === null
      ? db.prepare('SELECT payload FROM (SELECT seq, payload FROM messages WHERE room_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq').all(roomId, size)
      : db.prepare('SELECT payload FROM (SELECT seq, payload FROM messages WHERE room_id = ? AND work_round_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq').all(roomId, workRoundId, size)
    return rows.map(row => JSON.parse(row.payload))
  }
  const maxMessageSeq = roomId => db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE room_id = ?').get(roomId)?.seq ?? 0
  // 证据就是消息流里的命令/人工结果；不再维护单独的账本表与摘要。
  const readEvidence = (roomId, { workRoundId = null } = {}) => readMessages(roomId, { workRoundId })
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
  const readAssignment = (id, roomId = null) => {
    const row = roomId === null
      ? db.prepare('SELECT payload FROM assignment WHERE id = ?').get(id)
      : db.prepare('SELECT payload FROM assignment WHERE id = ? AND room_id = ?').get(id, roomId)
    return row === undefined ? null : JSON.parse(row.payload)
  }
  const readAssignments = (roomId, { workRoundId = null, stage = null, status = null, before = null, limit = 500 } = {}) => {
    const where = ['room_id = ?']
    const params = [roomId]
    if (typeof workRoundId === 'string' && workRoundId !== '') { where.push('work_round_id = ?'); params.push(workRoundId) }
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
      db.prepare('DELETE FROM work_round WHERE room_id = ?').run(id)
      db.prepare('DELETE FROM room_event WHERE room_id = ?').run(id)
      db.prepare('DELETE FROM room_inbox WHERE room_id = ?').run(id)
      db.prepare('DELETE FROM room_timer WHERE room_id = ?').run(id)
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

  // 房间收件箱：同一间房同一时刻只让一个 worker 领取；source_id 用来去重。
  const enqueueInbox = ({ roomId, kind, payload = {}, sourceId = null }) => {
    if (typeof roomId !== 'string' || roomId === '' || typeof kind !== 'string' || kind === '') return null
    const id = randomUUID()
    const now = Date.now()
    const result = db.prepare(
      'INSERT OR IGNORE INTO room_inbox (id, room_id, kind, source_id, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, roomId, kind, sourceId, JSON.stringify(payload), 'pending', now)
    return result.changes > 0 ? { id, roomId, kind, sourceId, payload, createdAt: now } : null
  }
  const claimInbox = roomId => {
    const row = db.prepare(
      "SELECT id, room_id, kind, source_id, payload, created_at FROM room_inbox WHERE room_id = ? AND status = 'pending' ORDER BY seq LIMIT 1",
    ).get(roomId)
    if (row === undefined) return null
    const claimed = db.prepare(
      "UPDATE room_inbox SET status = 'running', claimed_at = ? WHERE id = ? AND status = 'pending'",
    ).run(Date.now(), row.id)
    return claimed.changes > 0 ? {
      id: row.id,
      roomId: row.room_id,
      kind: row.kind,
      sourceId: row.source_id,
      payload: JSON.parse(row.payload),
      createdAt: row.created_at,
    } : null
  }
  const completeInbox = id => db.prepare("UPDATE room_inbox SET status = 'done' WHERE id = ?").run(id)
  const failInbox = id => db.prepare("UPDATE room_inbox SET status = 'failed' WHERE id = ?").run(id)
  const readInbox = (roomId, { status = null } = {}) => {
    const where = ['room_id = ?']
    const params = [roomId]
    if (status !== null) { where.push('status = ?'); params.push(status) }
    return db.prepare(`SELECT id, room_id, kind, source_id, payload, status, created_at FROM room_inbox WHERE ${where.join(' AND ')} ORDER BY seq`)
      .all(...params).map(row => ({ ...row, payload: JSON.parse(row.payload) }))
  }

  // 持久定时器：进程重启后仍能找到到点的事件。
  const setTimer = ({ id = randomUUID(), roomId, kind, payload = {}, dueAt }) => {
    if (typeof roomId !== 'string' || roomId === '' || typeof kind !== 'string' || kind === '') return null
    const at = Number(dueAt)
    if (!Number.isFinite(at)) return null
    db.prepare(
      'INSERT INTO room_timer (id, room_id, kind, payload, due_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET room_id = excluded.room_id, kind = excluded.kind, payload = excluded.payload, due_at = excluded.due_at, status = excluded.status',
    ).run(id, roomId, kind, JSON.stringify(payload), at, 'pending', Date.now())
    return { id, roomId, kind, payload, dueAt: at }
  }
  const dueTimers = (now = Date.now()) => db.prepare(
    "SELECT id, room_id, kind, payload, due_at, created_at FROM room_timer WHERE status = 'pending' AND due_at <= ? ORDER BY due_at",
  ).all(now).map(row => ({
    id: row.id,
    roomId: row.room_id,
    kind: row.kind,
    payload: JSON.parse(row.payload),
    dueAt: row.due_at,
    createdAt: row.created_at,
  }))
  const completeTimer = id => db.prepare("UPDATE room_timer SET status = 'done' WHERE id = ? AND status = 'pending'").run(id)
  const cancelTimer = id => db.prepare("UPDATE room_timer SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(id)

  // transcript.jsonl 先写，SQLite 后写；库是真相，jsonl 是崩溃恢复日志与可读镜像。
  // 示例种子只进 SQLite，不写目标仓库，避免样例数据污染用户仓库。
  const workRoundIdOf = message => (
    typeof message?.workRoundId === 'string' && message.workRoundId !== ''
      ? message.workRoundId
      : typeof message?.meta?.workRoundId === 'string' && message.meta.workRoundId !== ''
        ? message.meta.workRoundId
        : null
  )
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
    const row = db.prepare('SELECT seq, room_id FROM messages WHERE id = ?').get(message.id)
    if (row !== undefined) {
      if (row.room_id !== message.roomId) return null
      const updated = { ...message, seq: row.seq }
      db.prepare('UPDATE messages SET work_round_id = ?, payload = ? WHERE id = ?')
        .run(workRoundIdOf(updated), JSON.stringify(updated), updated.id)
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

  // 事件镜像也补缺，不覆盖库里的记录。
  const recoverEvent = event => {
    if (typeof event?.id !== 'string' || event.id === '' || typeof event?.roomId !== 'string') return null
    if (db.prepare('SELECT 1 FROM room_event WHERE id = ?').get(event.id) !== undefined) return null
    db.prepare('INSERT INTO room_event (id, room_id, type, payload, at) VALUES (?, ?, ?, ?, ?)')
      .run(event.id, event.roomId, String(event.type ?? ''), JSON.stringify(event.payload ?? {}), event.at ?? Date.now())
    return event
  }

  // 工具步骤和审计事件可以保留最近一段；聊天、证据和结论不自动删。
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

  // 崩溃恢复只补日志里有、库里没有的消息；已有消息永远以库为准。
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
    db,
    fresh,
    readRoom,
    readProfile,
    writeProfile,
    backup,
    writeRoom,
    updateRoom,
    readRooms,
    writeProject,
    readProject,
    readProjects,
    updateProject,
    nextWorkRoundOrdinal,
    writeWorkRound,
    readWorkRound,
    readWorkRounds,
    readWorkRoundsByProject,
    updateWorkRound,
    deleteWorkRoundsForRoom,
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
    recoverEvent,
    pruneActivityMessages,
    pruneEvents,
    appendMessage,
    upsertMessage,
    appendEvent,
    deleteRoom,
    readEvents,
    enqueueInbox,
    claimInbox,
    completeInbox,
    failInbox,
    readInbox,
    setTimer,
    dueTimers,
    completeTimer,
    cancelTimer,
  }
}
