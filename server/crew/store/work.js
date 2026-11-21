import { randomUUID } from 'node:crypto'
import { WORK_ITEM_STATUS } from '../../../shared/states.js'

const S = WORK_ITEM_STATUS

// 一条持久 work item 管定时、审批、重试和启动回收；同一间房同一时刻只让一个 worker 领取。
export const createWorkStore = ({ db }) => {
  const enqueueWork = ({
    id = randomUUID(),
    roomId,
    roundId = null,
    kind,
    payload = {},
    dedupeKey = null,
    availableAt = Date.now(),
    maxAttempts = 3,
  }) => {
    if (typeof roomId !== 'string' || roomId === '' || typeof kind !== 'string' || kind === '') return null
    const now = Date.now()
    const at = Number(availableAt)
    if (!Number.isFinite(at)) return null
    if (dedupeKey !== null) {
      const result = db.prepare(
        `INSERT OR IGNORE INTO work_item (id, room_id, round_id, kind, payload, status, attempts, max_attempts, available_at, dedupe_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      ).run(id, roomId, roundId, kind, JSON.stringify(payload), S.pending, Math.max(1, maxAttempts), at, dedupeKey, now, now)
      return result.changes > 0 ? { id, roomId, roundId, kind, payload, dedupeKey, availableAt: at, createdAt: now } : null
    }
    // 同一个 id 再投一次是“重设到点时间”：重开一项已领或被取消的活。
    db.prepare(
      `INSERT INTO work_item (id, room_id, round_id, kind, payload, status, attempts, max_attempts, available_at, dedupe_key, lease_until, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, NULL, ?, ?) ON CONFLICT(id) DO UPDATE SET room_id = excluded.room_id, round_id = excluded.round_id, kind = excluded.kind, payload = excluded.payload, status = excluded.status, attempts = 0, max_attempts = excluded.max_attempts, available_at = excluded.available_at, lease_until = NULL, last_error = NULL, updated_at = excluded.updated_at`,
    ).run(id, roomId, roundId, kind, JSON.stringify(payload), S.pending, Math.max(1, maxAttempts), at, now, now)
    return { id, roomId, roundId, kind, payload, dedupeKey, availableAt: at, createdAt: now }
  }

  const claimWork = (roomId, { now = Date.now(), leaseMs = 60_000 } = {}) => {
    const row = db.prepare(
      `SELECT id, room_id, round_id, kind, payload, attempts, max_attempts, created_at FROM work_item WHERE room_id = ? AND status = '${S.pending}' AND available_at <= ? ORDER BY available_at, seq LIMIT 1`,
    ).get(roomId, now)
    if (row === undefined) return null
    const claimed = db.prepare(
      `UPDATE work_item SET status = '${S.leased}', lease_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = '${S.pending}'`,
    ).run(now + leaseMs, now, row.id)
    return claimed.changes > 0 ? {
      id: row.id,
      roomId: row.room_id,
      roundId: row.round_id,
      kind: row.kind,
      payload: JSON.parse(row.payload),
      attempts: Number(row.attempts) + 1,
      maxAttempts: row.max_attempts,
      createdAt: row.created_at,
    } : null
  }

  const completeWork = id => db.prepare(
    `UPDATE work_item SET status = '${S.done}', lease_until = NULL, last_error = NULL, updated_at = ? WHERE id = ?`,
  ).run(Date.now(), id)

  const failWork = (id, error = '') => {
    const row = db.prepare('SELECT attempts, max_attempts FROM work_item WHERE id = ?').get(id)
    if (row === undefined) return null
    const attempts = Number(row.attempts) || 0
    if (attempts >= (Number(row.max_attempts) || 3)) {
      const result = db.prepare(
        `UPDATE work_item SET status = '${S.failed}', lease_until = NULL, last_error = ?, updated_at = ? WHERE id = ?`,
      ).run(String(error).slice(0, 500), Date.now(), id)
      return { ...result, dead: true }
    }
    const delay = Math.min(1000 * 2 ** attempts, 300_000)
    const result = db.prepare(
      `UPDATE work_item SET status = '${S.pending}', lease_until = NULL, available_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
    ).run(Date.now() + delay, String(error).slice(0, 500), Date.now(), id)
    return { ...result, dead: false }
  }

  const reclaimWork = ({ now = Date.now() } = {}) => {
    const dead = db.prepare(
      `SELECT id, room_id, kind, attempts FROM work_item WHERE status = '${S.leased}' AND lease_until IS NOT NULL AND lease_until <= ? AND attempts >= max_attempts`,
    ).all(now)
    const result = db.prepare(
      `UPDATE work_item SET status = CASE WHEN attempts >= max_attempts THEN '${S.failed}' ELSE '${S.pending}' END, lease_until = NULL, available_at = ?, updated_at = ? WHERE status = '${S.leased}' AND lease_until IS NOT NULL AND lease_until <= ?`,
    ).run(now, now, now)
    return { changes: Number(result.changes), dead }
  }

  const readWork = (roomId, { status = null } = {}) => {
    const where = ['room_id = ?']
    const params = [roomId]
    if (status !== null) { where.push('status = ?'); params.push(status) }
    return db.prepare(`SELECT id, room_id, round_id, kind, payload, status, attempts, max_attempts, available_at, lease_until, dedupe_key, last_error, created_at, updated_at FROM work_item WHERE ${where.join(' AND ')} ORDER BY seq`)
      .all(...params).map(row => ({ ...row, payload: JSON.parse(row.payload) }))
  }

  const cancelWork = id => db.prepare(
    `UPDATE work_item SET status = '${S.cancelled}', updated_at = ? WHERE id = ? AND status IN ('${S.pending}', '${S.leased}')`,
  ).run(Date.now(), id)

  return { enqueueWork, claimWork, completeWork, failWork, reclaimWork, readWork, cancelWork }
}
