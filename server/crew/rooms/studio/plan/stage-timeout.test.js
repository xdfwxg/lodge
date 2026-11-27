import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStore } from '../../../store.js'
import { createAssignment, transitionAssignment } from '../../../assignments.js'
import { createStageStarter } from './stage.js'

const setup = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lodge-timeout-'))
  const repo = mkdtempSync(join(tmpdir(), 'lodge-timeout-repo-'))
  const store = createStore({ dataDir })
  store.writeRoom({
    id: 'room-1',
    kind: 'room',
    roomType: 'studio',
    name: '超时',
    goal: '验证超时收口',
    state: 'active',
    live: true,
    repoPath: repo,
    sourceRepo: repo,
    leadMemberId: 'lead',
    stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
    members: [
      { id: 'lead', name: '规划师', role: 'lead', roleKind: 'planner' },
      { id: 'worker', name: '执行官', role: 'worker', roleKind: 'executor' },
      { id: 'worker-2', name: '执行官二', role: 'worker', roleKind: 'executor' },
    ],
  })
  return { dataDir, repo, store }
}

const dispatch = (store, toMemberId, status = 'sent') => createAssignment({
  store,
  roomId: 'room-1',
  stageIndex: 0,
  fromMemberId: 'lead',
  toMemberId,
  reason: 'dispatch',
  status,
})

const waitFor = async (check, label, tries = 100) => {
  for (let at = 0; at < tries; at += 1) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`timeout: ${label}`)
}

test('a stage deadline measures silence: a member that keeps working is not stopped', async () => {
  const ctx = setup()
  try {
    const assignment = dispatch(ctx.store, 'worker')
    const starter = createStageStarter({
      store: ctx.store,
      roomId: 'room-1',
      emit: () => {},
      integrate: async () => {},
      enqueue: task => task(),
      timeoutMs: 120,
    })
    starter.watchStageTimeout(0)
    await new Promise(resolve => setTimeout(resolve, 60))
    // 第一拍到点前，成员还在跑工具：这不是超时，只是慢。
    ctx.store.appendMessage('room-1', { kind: 'activity', authorId: 'worker', text: 'bash', meta: { tool: 'bash', ok: true } })
    await new Promise(resolve => setTimeout(resolve, 140))
    assert.equal(ctx.store.readAssignment(assignment.id).status, 'sent')
    assert.equal(ctx.store.readRoom('room-1').blocked, undefined)
    assert.ok(!ctx.store.readMessages('room-1').some(message => /执行超时/.test(message.text ?? '')))
    assert.ok(
      ctx.store.readWork('room-1').some(item => item.kind === 'stage.deadline' && item.status === 'pending' && /:1$/.test(item.id)),
      '续期排了一条新的截止项',
    )

    // 真静下来之后才收口：同一套判定，不是永不过期。
    await waitFor(() => ctx.store.readRoom('room-1').blocked?.reason === 'timeout', '静默之后收口')
    assert.equal(ctx.store.readAssignment(assignment.id).status, 'failed')
    assert.equal(ctx.store.readWork('room-1').some(item => item.kind === 'stage.deadline' && item.status === 'pending'), false)
  } finally {
    ctx.store.db.close()
    rmSync(ctx.dataDir, { recursive: true, force: true })
    rmSync(ctx.repo, { recursive: true, force: true })
  }
})

test('an assignment whose member is still working is renewed, not failed', async () => {
  const ctx = setup()
  try {
    const assignment = dispatch(ctx.store, 'worker')
    const starter = createStageStarter({
      store: ctx.store,
      roomId: 'room-1',
      emit: () => {},
      integrate: async () => {},
      enqueue: task => task(),
      leaseMs: 120,
    })
    ctx.store.appendMessage('room-1', { kind: 'chat', authorId: 'worker', text: '在跑测试，等结果。' })
    assert.equal(starter.expireAssignment(assignment.id), true)
    assert.equal(ctx.store.readAssignment(assignment.id).status, 'sent')
    const pending = ctx.store.readWork('room-1').filter(item => item.kind === 'assignment.lease' && item.status === 'pending')
    assert.equal(pending.length, 1, '续租排了一条新的到期项')
    assert.match(pending[0].id, /:1$/)

    // 之后真静了这么久：同样的检查会停掉这位成员。
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(starter.expireAssignment(assignment.id), true)
    assert.equal(ctx.store.readAssignment(assignment.id).status, 'failed')
    assert.ok(ctx.store.readMessages('room-1').some(message => /长时间没有进展/.test(message.text ?? '')))
  } finally {
    ctx.store.db.close()
    rmSync(ctx.dataDir, { recursive: true, force: true })
    rmSync(ctx.repo, { recursive: true, force: true })
  }
})

test('a timed-out stage fails the open assignment and blocks for the human', async () => {
  const ctx = setup()
  try {
    const assignment = dispatch(ctx.store, 'worker')
    const starter = createStageStarter({
      store: ctx.store,
      roomId: 'room-1',
      emit: () => {},
      integrate: async () => {},
      enqueue: task => task(),
      timeoutMs: 20,
    })
    assert.equal(starter.watchStageTimeout(0), true)
    const queued = ctx.store.readWork('room-1').find(item => item.kind === 'stage.deadline')
    assert.equal(queued.status, 'pending')
    assert.equal(queued.payload.stage, 0)
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(ctx.store.readWork('room-1').find(item => item.kind === 'stage.deadline').status, 'cancelled')
    assert.equal(ctx.store.readAssignment(assignment.id).status, 'failed')
    const room = ctx.store.readRoom('room-1')
    assert.equal(room.blocked.reason, 'timeout')
    assert.equal(room.blocked.stage, 0)
    assert.ok(ctx.store.readMessages('room-1').some(message => /执行超时/.test(message.text ?? '')))
  } finally {
    ctx.store.db.close()
    rmSync(ctx.dataDir, { recursive: true, force: true })
    rmSync(ctx.repo, { recursive: true, force: true })
  }
})

test('a timeout actually stops the member, not just its assignment', async () => {
  const ctx = setup()
  try {
    dispatch(ctx.store, 'worker')
    const stopped = []
    const starter = createStageStarter({
      store: ctx.store,
      roomId: 'room-1',
      emit: () => {},
      integrate: async () => {},
      enqueue: task => task(),
      interrupt: memberId => stopped.push(memberId),
      timeoutMs: 20,
    })
    starter.watchStageTimeout(0)
    await new Promise(resolve => setTimeout(resolve, 80))
    // 判了超时还要真的停人：否则状态说“已停下”，进程还在烧额度。
    assert.deepEqual(stopped, ['worker'])
  } finally {
    ctx.store.db.close()
    rmSync(ctx.dataDir, { recursive: true, force: true })
    rmSync(ctx.repo, { recursive: true, force: true })
  }
})

test('an expired assignment stops only that member and keeps the stage waiting', () => {
  const ctx = setup()
  try {
    const first = dispatch(ctx.store, 'worker')
    const second = dispatch(ctx.store, 'worker-2')
    const starter = createStageStarter({
      store: ctx.store,
      roomId: 'room-1',
      emit: () => {},
      integrate: async () => {},
      enqueue: task => task(),
    })
    assert.equal(starter.watchStageTimeout(0), true)
    assert.equal(starter.expireAssignment(first.id), true)
    assert.equal(ctx.store.readAssignment(first.id).status, 'failed')
    assert.equal(ctx.store.readAssignment(second.id).status, 'sent')
    assert.equal(ctx.store.readRoom('room-1').blocked, undefined)
    assert.equal(ctx.store.readWork('room-1').find(item => item.kind === 'stage.deadline').status, 'pending')

    assert.equal(starter.expireAssignment(second.id), true)
    const room = ctx.store.readRoom('room-1')
    assert.equal(room.blocked.reason, 'timeout')
    assert.equal(room.blocked.source, 'lease')
    assert.equal(ctx.store.readWork('room-1').find(item => item.kind === 'stage.deadline').status, 'cancelled')
    assert.ok(ctx.store.readMessages('room-1').some(message => /长时间没有进展/.test(message.text ?? '')))
  } finally {
    ctx.store.db.close()
    rmSync(ctx.dataDir, { recursive: true, force: true })
    rmSync(ctx.repo, { recursive: true, force: true })
  }
})

test('an expired assignment still integrates the members that did report', async () => {
  const ctx = setup()
  try {
    const reported = dispatch(ctx.store, 'worker')
    transitionAssignment(ctx.store, reported.id, 'reported')
    const stalled = dispatch(ctx.store, 'worker-2')
    const integrated = []
    const starter = createStageStarter({
      store: ctx.store,
      roomId: 'room-1',
      emit: () => {},
      integrate: async options => integrated.push(options),
      enqueue: task => task(),
    })
    assert.equal(starter.expireAssignment(stalled.id), true)
    assert.equal(integrated.length, 1)
    assert.deepEqual(integrated[0].workers, ['worker'])
    assert.deepEqual(integrated[0].failed, ['worker-2'])
  } finally {
    ctx.store.db.close()
    rmSync(ctx.dataDir, { recursive: true, force: true })
    rmSync(ctx.repo, { recursive: true, force: true })
  }
})

test('a timed-out stage integrates the members that did report', async () => {
  const ctx = setup()
  try {
    const done = dispatch(ctx.store, 'worker')
    transitionAssignment(ctx.store, done.id, 'reported')
    dispatch(ctx.store, 'worker-2')
    const integrated = []
    const starter = createStageStarter({
      store: ctx.store,
      roomId: 'room-1',
      emit: () => {},
      integrate: async args => { integrated.push(args) },
      enqueue: task => task(),
      timeoutMs: 20,
    })
    starter.watchStageTimeout(0)
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(integrated.length, 1)
    assert.deepEqual(integrated[0].workers, ['worker'])
    assert.deepEqual(integrated[0].failed, ['worker-2'])
  } finally {
    ctx.store.db.close()
    rmSync(ctx.dataDir, { recursive: true, force: true })
    rmSync(ctx.repo, { recursive: true, force: true })
  }
})
