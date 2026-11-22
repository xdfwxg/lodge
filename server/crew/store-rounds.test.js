import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_VERSION, createStore } from './store.js'

const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-store-rounds-'))
  return { dir, store: createStore({ dataDir: dir }) }
}

test('a fresh store carries the current schema version', () => {
  const { dir, store } = temp()
  try {
    assert.equal(Number(store.db.prepare('PRAGMA user_version').get().user_version), SCHEMA_VERSION)
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an old schema refuses to open until the data reset', () => {
  const { dir, store } = temp()
  store.db.exec('PRAGMA user_version = 1')
  store.db.close()
  try {
    assert.throws(
      () => createStore({ dataDir: dir }),
      /npm run data:reset/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('projects keep a versioned north star across updates', () => {
  const { dir, store } = temp()
  try {
    const project = store.writeProject({ id: 'project-1', name: 'Lodge', northStar: '住得更好' })
    assert.deepEqual(store.readProject('project-1'), project)
    const updated = store.updateProject('project-1', current => {
      current.northStar = '住得更安静'
      return true
    })
    assert.equal(updated.northStar, '住得更安静')
    assert.equal(updated.version, 2)
    assert.deepEqual(store.readProjects().map(item => item.id), ['project-1'])
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('work rounds are ordinal, project-scoped and versioned', () => {
  const { dir, store } = temp()
  try {
    const first = store.writeWorkRound({
      id: 'round-1', roomId: 'room-1', projectId: 'project-1', goal: '修登录超时',
    })
    assert.equal(first.ordinal, 1)
    assert.equal(first.status, 'planning')
    store.updateWorkRound('round-1', current => {
      current.status = 'completed'
      return true
    })
    const second = store.writeWorkRound({
      id: 'round-2', roomId: 'room-1', projectId: 'project-2', goal: '加导出',
    })
    assert.equal(second.ordinal, 2)
    assert.equal(store.nextWorkRoundOrdinal('room-1'), 3)
    assert.deepEqual(store.readWorkRounds('room-1').map(item => item.id), ['round-1', 'round-2'])
    assert.deepEqual(store.readWorkRoundsByProject('project-1').map(item => item.id), ['round-1'])

    const updated = store.updateWorkRound('round-2', current => {
      current.status = 'completed'
      return true
    })
    assert.equal(updated.status, 'completed')
    assert.equal(updated.version, 2)
    assert.equal(store.readWorkRound('round-2', 'room-1').status, 'completed')
    assert.equal(store.readWorkRound('round-2', 'other-room'), null)
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a round starts and finishes atomically, with one open round per room', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({
      id: 'room-1', name: '工作室', roomType: 'studio', state: 'idle',
      activeRoundId: null, lastRoundId: null, members: [],
    })
    const started = store.startWorkRound({
      roomId: 'room-1',
      round: { id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'active', goal: '修登录超时', stages: [] },
    })
    assert.equal(started.room.state, 'active')
    assert.equal(started.room.activeRoundId, 'round-1')
    assert.equal(store.startWorkRound({
      roomId: 'room-1',
      round: { id: 'round-2', roomId: 'room-1', ordinal: 2, status: 'active', goal: '加导出', stages: [] },
    }), null)

    const finished = store.finishWorkRound({
      roomId: 'room-1',
      roundId: 'round-1',
      status: 'completed',
      eventType: 'round.completed',
      idempotencyKey: 'round-complete:round-1',
      message: { kind: 'conclusion', authorId: 'planner', text: '已交付：修登录超时', meta: { roundId: 'round-1' } },
    })
    assert.equal(finished.room.state, 'idle')
    assert.equal(finished.room.activeRoundId, null)
    assert.equal(finished.room.lastRoundId, 'round-1')
    assert.equal(finished.round.status, 'completed')
    assert.equal(finished.message.workRoundId, 'round-1')

    const duplicate = store.finishWorkRound({
      roomId: 'room-1',
      roundId: 'round-1',
      status: 'completed',
      eventType: 'round.completed',
      idempotencyKey: 'round-complete:round-1',
      message: { kind: 'conclusion', authorId: 'planner', text: '已交付：修登录超时', meta: { roundId: 'round-1' } },
    })
    assert.equal(duplicate.duplicate, true)
    assert.equal(store.readMessages('room-1').filter(message => message.kind === 'conclusion').length, 1)

    store.appendMessage('room-1', { kind: 'chat', authorId: 'you', text: '空闲时说的话' })
    assert.equal(store.readMessages('room-1').some(message => message.text === '空闲时说的话'), true)
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('finishing a round cancels its work and leaves room-level work alone', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({
      id: 'room-1', name: '工作室', roomType: 'studio', state: 'active', activeRoundId: 'round-1',
    })
    store.startWorkRound({
      roomId: 'room-1',
      round: { id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'active', goal: '修登录超时', stages: [] },
    })
    store.enqueueWork({ roomId: 'room-1', roundId: 'round-1', kind: 'round-work', payload: {} })
    store.enqueueWork({ roomId: 'room-1', kind: 'approval', dedupeKey: 'room-card', payload: {} })

    store.finishWorkRound({ roomId: 'room-1', roundId: 'round-1', status: 'completed' })

    const items = store.readWork('room-1')
    assert.equal(items.find(item => item.round_id === 'round-1').status, 'cancelled')
    assert.equal(items.find(item => item.round_id === null).status, 'pending')
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reclaiming an expired lease reports work that ran out of attempts', () => {
  const { dir, store } = temp()
  try {
    store.enqueueWork({ id: 'dead-1', roomId: 'room-1', kind: 'approval', availableAt: 0, maxAttempts: 1 })
    const claimed = store.claimWork('room-1', { now: 1_000, leaseMs: 10 })
    assert.equal(claimed.id, 'dead-1')
    const reclaimed = store.reclaimWork({ now: 2_000 })
    assert.deepEqual(reclaimed.dead.map(item => item.id), ['dead-1'])
    assert.equal(store.readWork('room-1')[0].status, 'failed')
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('replayed events keep the idempotency key guard', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({ id: 'room-1', name: '工作室', state: 'active', activeRoundId: 'round-1' })
    store.startWorkRound({
      roomId: 'room-1',
      round: { id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'active', goal: '修登录超时', stages: [] },
    })
    store.finishWorkRound({
      roomId: 'room-1', roundId: 'round-1', status: 'completed',
      eventType: 'round.completed', idempotencyKey: 'round-complete:round-1',
    })
    assert.equal(store.recoverEvent({
      id: 'replayed-event', roomId: 'room-1', type: 'round.completed',
      payload: {}, idempotencyKey: 'round-complete:round-1',
    }), null)
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('expired work leases are reclaimed and failures back off', () => {
  const { dir, store } = temp()
  try {
    const queued = store.enqueueWork({ roomId: 'room-1', kind: 'approval', dedupeKey: 'source-1', availableAt: 0 })
    const first = store.claimWork('room-1', { now: 1_000, leaseMs: 10 })
    assert.equal(first.id, queued.id)
    assert.equal(store.reclaimWork({ now: 2_000 }).changes, 1)
    assert.equal(store.readWork('room-1')[0].status, 'pending')
    const second = store.claimWork('room-1', { now: 3_000, leaseMs: 10 })
    assert.equal(second.id, queued.id)
    store.failWork(queued.id, 'temporary failure')
    const pending = store.readWork('room-1')[0]
    assert.equal(pending.status, 'pending')
    assert.equal(pending.attempts, 2)
    assert.match(pending.last_error, /temporary failure/)
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updateRound reads the active round as a view and writes its fields back to the round', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({
      id: 'room-1', name: '工作室', state: 'active', activeRoundId: 'round-1',
      members: [], roomType: 'studio',
    })
    store.writeWorkRound({
      id: 'round-1', roomId: 'room-1', goal: '修登录超时',
      stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
    })

    const view = store.readRoom('room-1')
    assert.equal(view.goal, '修登录超时')
    assert.equal(view.workRound.id, 'round-1')
    assert.equal(view.stages[0].state, 'active')

    const updated = store.updateRound('room-1', current => {
      current.stages[0].state = 'passed'
      return { events: [] }
    })
    assert.equal(updated.stages[0].state, 'passed')
    assert.equal(store.readWorkRound('round-1').stages[0].state, 'passed')

    const raw = JSON.parse(store.db.prepare('SELECT payload FROM room WHERE id = ?').get('room-1').payload)
    assert.equal(raw.stages, undefined)
    assert.equal(raw.goal, undefined)
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a completed round stays readable after the studio goes idle', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({
      id: 'room-1', name: '工作室', state: 'idle', lastRoundId: 'round-1',
    })
    store.writeWorkRound({
      id: 'round-1', roomId: 'room-1', goal: '修登录超时', status: 'completed',
    })
    const view = store.readRoom('room-1')
    assert.equal(view.state, 'idle')
    assert.equal(view.goal, '修登录超时')
    assert.equal(view.workRound.status, 'completed')
    assert.throws(
      () => store.updateRound('room-1', current => { current.goal = '改旧轮' ; return { events: [] } }),
      /已结束的轮次/,
    )
    assert.equal(store.readWorkRound('round-1', 'room-1').goal, '修登录超时')
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('messages and assignments default to the active round', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({
      id: 'room-1', demo: true, name: '工作室', roomType: 'studio', state: 'active', activeRoundId: 'round-1',
    })
    store.appendMessage('room-1', { kind: 'system', text: '这一轮' })
    store.appendMessage('room-1', { kind: 'system', text: '旧轮', workRoundId: 'round-0' })
    assert.deepEqual(store.readMessages('room-1').map(item => item.text), ['这一轮'])
    assert.deepEqual(store.readMessages('room-1', { workRoundId: null }).map(item => item.text), ['这一轮', '旧轮'])
    assert.equal(store.readMessages('room-1')[0].workRoundId, 'round-1')

    store.writeAssignment({ id: 'assignment-1', roomId: 'room-1', stageIndex: 0, status: 'created' })
    assert.equal(store.readAssignment('assignment-1').workRoundId, 'round-1')
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a studio message after completion belongs to the last round, not the room', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({
      id: 'room-1', demo: true, name: '工作室', roomType: 'studio', state: 'idle', lastRoundId: 'round-1',
    })
    store.appendMessage('room-1', { kind: 'chat', text: '迟到的总结' })
    assert.equal(store.readMessages('room-1')[0].workRoundId, 'round-1')

    // 聊天室是连续时间线，不按轮次切走。
    store.writeRoom({
      id: 'room-2', demo: true, name: '聊天室', roomType: 'chat', state: 'active', activeRoundId: 'round-9',
    })
    store.appendMessage('room-2', { kind: 'chat', text: '聊天' })
    assert.equal(store.readMessages('room-2')[0].workRoundId, undefined)
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('messages and assignments can be read inside one work round only', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({ id: 'room-1', demo: true, name: '工作室', state: 'idle' })
    store.appendMessage('room-1', { kind: 'system', text: '第一轮', workRoundId: 'round-1' })
    store.appendMessage('room-1', { kind: 'system', text: '第二轮', workRoundId: 'round-2' })
    assert.deepEqual(store.readMessages('room-1', { workRoundId: 'round-1' }).map(item => item.text), ['第一轮'])
    assert.deepEqual(store.readMessages('room-1').map(item => item.text), ['第一轮', '第二轮'])

    store.writeAssignment({
      id: 'assignment-1', roomId: 'room-1', workRoundId: 'round-1', stageIndex: 0, status: 'created',
    })
    store.writeAssignment({
      id: 'assignment-2', roomId: 'room-1', workRoundId: 'round-2', stageIndex: 0, status: 'created',
    })
    assert.deepEqual(
      store.readAssignments('room-1', { workRoundId: 'round-1' }).map(item => item.id),
      ['assignment-1'],
    )
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleting a room cascades its rounds and round-scoped rows', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({ id: 'room-1', demo: true, name: '工作室', state: 'idle' })
    store.writeWorkRound({ id: 'round-1', roomId: 'room-1', goal: '修登录超时' })
    store.appendMessage('room-1', { kind: 'system', text: '第一轮', workRoundId: 'round-1' })
    store.writeAssignment({
      id: 'assignment-1', roomId: 'room-1', workRoundId: 'round-1', stageIndex: 0, status: 'created',
    })

    assert.equal(store.deleteRoom('room-1'), true)
    assert.equal(store.readWorkRound('round-1'), null)
    assert.deepEqual(store.readMessages('room-1'), [])
    assert.deepEqual(store.readAssignments('room-1'), [])
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a message that started in the previous round stays in the previous round', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({
      id: 'room-1', name: '工作室', roomType: 'studio', state: 'idle',
      activeRoundId: null, lastRoundId: null, members: [],
    })
    store.startWorkRound({ roomId: 'room-1', round: { id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'active', startedAt: 1000, goal: '第一步', stages: [] } })
    store.finishWorkRound({ roomId: 'room-1', roundId: 'round-1', status: 'completed' })
    store.startWorkRound({ roomId: 'room-1', round: { id: 'round-2', roomId: 'room-1', ordinal: 2, status: 'active', startedAt: 3000, goal: '第二步', stages: [] } })
    const late = store.upsertMessage({ id: 'late-1', roomId: 'room-1', ts: 2500, kind: 'chat', authorId: 'planner', text: '上一轮的收尾' })
    assert.equal(late.workRoundId, 'round-1')
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a version 6 database realigns late messages by their own time', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({
      id: 'room-1', name: '工作室', roomType: 'studio', state: 'idle',
      activeRoundId: null, lastRoundId: null, members: [],
    })
    store.startWorkRound({ roomId: 'room-1', round: { id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'active', startedAt: 1000, goal: '第一步', stages: [] } })
    store.finishWorkRound({ roomId: 'room-1', roundId: 'round-1', status: 'completed' })
    store.startWorkRound({ roomId: 'room-1', round: { id: 'round-2', roomId: 'room-1', ordinal: 2, status: 'active', startedAt: 3000, goal: '第二步', stages: [] } })
    store.db.prepare('INSERT INTO messages (seq, id, room_id, work_round_id, payload) VALUES (?, ?, ?, ?, ?)')
      .run(1, 'late-1', 'room-1', 'round-2', JSON.stringify({ id: 'late-1', roomId: 'room-1', ts: 2500, kind: 'chat', text: '上一轮的收尾' }))
    store.db.close()

    const old = new DatabaseSync(join(dir, 'crew.db'))
    old.exec('PRAGMA user_version = 6')
    old.close()

    const migrated = createStore({ dataDir: dir })
    const row = migrated.db.prepare("SELECT work_round_id FROM messages WHERE id = 'late-1'").get()
    assert.equal(row.work_round_id, 'round-1')
    migrated.db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
