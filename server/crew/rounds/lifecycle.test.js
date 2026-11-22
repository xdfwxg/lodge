import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from '../store.js'
import { failRound, rejectRound, stopRound } from './lifecycle.js'
import { buildRound, buildRoundFromRoom, shortTitleOf } from './record.js'

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-lifecycle-'))
  const store = createStore({ dataDir: dir })
  store.writeRoom({
    id: 'room-1', name: '工作室', roomType: 'studio', state: 'idle',
    activeRoundId: null, lastRoundId: null, members: [],
  })
  store.startWorkRound({
    roomId: 'room-1',
    round: { id: 'round-1', roomId: 'room-1', ordinal: 1, status: 'active', goal: '修登录超时', stages: [] },
  })
  return { dir, store }
}

const teardown = ({ dir, store }) => {
  store.db.close()
  rmSync(dir, { recursive: true, force: true })
}

const live = { cancel: async () => {}, detach: () => {} }
const emit = () => {}

test('stopping a round closes it and leaves the room idle', async () => {
  const ctx = setup()
  try {
    const result = await stopRound({ store: ctx.store, live, emit, room: ctx.store.readRoom('room-1'), reason: '不做了' })
    assert.equal(result.ok, true)
    const room = ctx.store.readRoom('room-1')
    assert.equal(room.state, 'idle')
    assert.equal(room.activeRoundId, null)
    assert.equal(room.lastRoundId, 'round-1')
    assert.equal(room.workRound.status, 'stopped')
  } finally {
    teardown(ctx)
  }
})

test('a rejected or failed round is terminal and clears the room pointer', async () => {
  for (const finish of [rejectRound, failRound]) {
    const ctx = setup()
    try {
      const result = await finish({ store: ctx.store, live, emit, room: ctx.store.readRoom('room-1'), reason: '目标不成立' })
      assert.equal(result.ok, true)
      const room = ctx.store.readRoom('room-1')
      assert.equal(room.activeRoundId, null)
      assert.equal(room.state, 'idle')
      assert.equal(room.workRound.status, finish === rejectRound ? 'rejected' : 'failed')
    } finally {
      teardown(ctx)
    }
  }
})

test('a new round starts without the previous round advice or previews', async () => {
  const ctx = setup()
  try {
    ctx.store.updateRound('room-1', current => {
      current.advisorShadow = { 0: { evidenceId: 'old-evidence', advice: [{ summary: '旧意见' }] } }
      current.previews = [{ stage: 0, evidenceId: 'old-evidence', path: 'old.png' }]
      current.reviewRetriedAt = 123
      current.stageDiagnostics = { 0: { outcome: 'old' } }
      current.mergeResolved = { stage: 0 }
      return { events: [] }
    })
    await stopRound({ store: ctx.store, live, emit, room: ctx.store.readRoom('room-1'), reason: '换一轮' })
    const previous = ctx.store.readRoom('room-1')
    ctx.store.startWorkRound({
      roomId: 'room-1',
      round: buildRound({
        room: previous,
        goal: '下一轮',
        name: '下一轮',
        ordinal: 2,
        stages: [],
      }),
    })
    const room = ctx.store.readRoom('room-1')
    assert.deepEqual(room.advisorShadow, {})
    assert.deepEqual(room.previews, [])
    assert.equal(room.reviewRetriedAt, null)
    assert.deepEqual(room.stageDiagnostics, {})
    assert.equal(room.mergeResolved, null)
  } finally {
    teardown(ctx)
  }
})

test('the first round is named by its goal, not the room name', () => {
  const round = buildRoundFromRoom({
    room: { id: 'r1', name: '测试房', goal: '保存后刷新仍生效', stages: [], members: [] },
    ordinal: 1,
  })
  assert.equal(round.name, '保存后刷新仍生效')
})

test('short titles share one truncation rule', () => {
  assert.equal(shortTitleOf(' 修登录超时 '), '修登录超时')
  assert.equal(shortTitleOf('a'.repeat(24)), 'a'.repeat(24))
  assert.equal(shortTitleOf('a'.repeat(25)), `${'a'.repeat(24)}…`)
  assert.equal(shortTitleOf('a'.repeat(25), { ellipsis: false }), 'a'.repeat(24))
  assert.equal(shortTitleOf(''), '')
})

test('a truncated title never leaves an unmatched quote', () => {
  const title = shortTitleOf('在 welcome.md 末尾再加一句「第 1 间第 1 轮完成」，前面的内容不要动')
  assert.equal(title, '在 welcome.md 末尾再加一句…')
  assert.equal(title.includes('「'), false)
})
