import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from './store.js'
import { stopRound } from './rounds/lifecycle.js'
import { reconcileRounds } from './rounds/recovery.js'

const ROOM = 'room-long'

const seed = (store, repo) => store.writeRoom({
  id: ROOM,
  kind: 'room',
  roomType: 'studio',
  name: '长任务',
  goal: '跨轮工作',
  state: 'idle',
  idle: true,
  activeRoundId: null,
  lastRoundId: null,
  members: [],
  repoPath: repo,
  sourceRepo: repo,
})

const start = (store, ordinal) => {
  const started = store.startWorkRound({
    roomId: ROOM,
    round: {
      id: `round-${ordinal}`,
      roomId: ROOM,
      ordinal,
      status: 'active',
      goal: `第 ${ordinal} 轮`,
      stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
    },
  })
  assert.notEqual(started, null)
}

const temp = () => ({
  dataDir: mkdtempSync(join(tmpdir(), 'lodge-long-store-')),
  repo: mkdtempSync(join(tmpdir(), 'lodge-long-repo-')),
})

test('stopping a round leaves no due work item behind', async () => {
  const { dataDir, repo } = temp()
  const store = createStore({ dataDir })
  try {
    seed(store, repo)
    start(store, 1)
    store.enqueueWork({ roomId: ROOM, roundId: 'round-1', kind: 'stage.deadline', payload: { stage: 0 } })
    store.enqueueWork({ roomId: ROOM, kind: 'approval', dedupeKey: 'room-card', payload: {} })

    const stopped = await stopRound({
      store,
      live: { cancel: async () => ({}), detach: () => {} },
      emit: () => {},
      room: store.readRoom(ROOM),
      reason: '先停下',
    })
    assert.equal(stopped.ok, true, stopped.error)
    assert.equal(store.readRoom(ROOM).state, 'idle')

    const items = store.readWork(ROOM)
    assert.deepEqual(items.filter(item => item.round_id === 'round-1').map(item => item.status), ['cancelled'])
    assert.equal(items.find(item => item.round_id === null).status, 'pending')
  } finally {
    store.db.close()
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})

test('a restart keeps the second round and the old round read-only', () => {
  const { dataDir, repo } = temp()
  let store = createStore({ dataDir })
  try {
    seed(store, repo)
    start(store, 1)
    store.appendMessage(ROOM, { kind: 'system', text: '第一轮', workRoundId: 'round-1' })
    store.finishWorkRound({ roomId: ROOM, roundId: 'round-1', status: 'completed', eventType: 'round.completed' })
    start(store, 2)
    store.appendMessage(ROOM, { kind: 'system', text: '第二轮', workRoundId: 'round-2' })

    store.db.close()
    store = createStore({ dataDir })
    reconcileRounds({ store, emit: () => {} })

    const room = store.readRoom(ROOM)
    assert.equal(room.activeRoundId, 'round-2')
    assert.equal(store.readWorkRound('round-1').status, 'completed')
    assert.deepEqual(store.readMessages(ROOM, { workRoundId: 'round-1' }).map(item => item.text), ['第一轮'])
    assert.deepEqual(store.readMessages(ROOM, { workRoundId: 'round-2' }).map(item => item.text), ['第二轮'])
  } finally {
    try { store.db.close() } catch {}
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
})
