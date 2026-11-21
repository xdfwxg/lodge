import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
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
    const second = store.writeWorkRound({
      id: 'round-2', roomId: 'room-1', projectId: 'project-2', goal: '加导出',
    })
    assert.equal(second.ordinal, 2)
    assert.equal(store.nextWorkRoundOrdinal('room-1'), 3)
    assert.deepEqual(store.readWorkRounds('room-1').map(item => item.id), ['round-1', 'round-2'])
    assert.deepEqual(store.readWorkRoundsByProject('project-1').map(item => item.id), ['round-1'])

    const updated = store.updateWorkRound('round-1', current => {
      current.status = 'completed'
      return true
    })
    assert.equal(updated.status, 'completed')
    assert.equal(updated.version, 2)
    assert.equal(store.readWorkRound('round-1', 'room-1').status, 'completed')
    assert.equal(store.readWorkRound('round-1', 'other-room'), null)
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a studio reads the active round as a view and writes its fields back to the round', () => {
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

    const updated = store.updateRoom('room-1', current => {
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
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('messages and assignments default to the active round', () => {
  const { dir, store } = temp()
  try {
    store.writeRoom({
      id: 'room-1', demo: true, name: '工作室', state: 'active', activeRoundId: 'round-1',
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
