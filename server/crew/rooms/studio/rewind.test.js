import assert from 'node:assert/strict'
import test from 'node:test'
import { createStageRewind } from './rewind.js'

const baseRoom = () => ({
  id: 'room-1',
  state: 'active',
  closure: 'executing',
  busy: false,
  live: false,
  stages: [
    { title: '目标对齐', kind: 'decision', state: 'passed' },
    { title: '实现', kind: 'deliverable', state: 'passed', acceptance: 'npm test' },
    { title: '测试', kind: 'deliverable', state: 'active', acceptance: 'npm test' },
  ],
  stageBases: { 1: 'base-1', 2: 'base-2' },
  workspace: { provider: 'git' },
})

const harness = ({ restore, provider } = {}) => {
  let current = baseRoom()
  const messages = []
  let events = []
  const store = {
    readRoom: () => current,
    updateRoom: (id, mutate) => {
      const next = structuredClone(current)
      const result = mutate(next)
      if (result === null) return null
      current = next
      events = result.events ?? []
      return current
    },
    appendMessage: (id, message) => {
      const stored = { id: `m${messages.length + 1}`, ...message }
      messages.push(stored)
      return stored
    },
  }
  const rewind = createStageRewind({
    store,
    live: {},
    emit: () => {},
    roomFiles: { writeGoal: () => {} },
    workspace: {
      provider: provider ?? (() => ({
        capabilities: () => ({ vcs: 'git' }),
        restore: restore ?? (() => ({ base: 'base-1', backups: ['rewind/room-1/room/1'] })),
      })),
    },
  })
  return {
    rewind,
    room: () => current,
    messages,
    events: () => events,
  }
}

test('rewind reopens the stage, resets later stages and keeps history', async () => {
  const run = harness()
  const result = await run.rewind(run.room(), { stage: 1 })
  assert.equal(result.ok, true)
  assert.deepEqual(run.room().stages.map(stage => stage.state), ['passed', 'active', 'pending'])
  assert.equal(run.room().closure, 'executing')
  assert.deepEqual(run.room().stageBases, { 1: 'base-1' })
  assert.equal(run.messages[0].kind, 'rework')
  assert.equal(run.messages[0].meta.rewind, true)
  assert.match(run.messages[1].text, /备份分支/)
  assert.equal(run.events().some(event => event.type === 'stage.rewound'), true)
  assert.equal(run.events().some(event => event.type === 'closure.transition' && event.payload.event === 'rewind'), true)
})

test('rewind refuses a dirty worktree and leaves the room untouched', async () => {
  const run = harness({
    restore: () => {
      throw new Error('还有未提交的改动：/repo；先等系统合并或清理再回退')
    },
  })
  const result = await run.rewind(run.room(), { stage: 1 })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'conflict')
  assert.match(result.error, /未提交的改动/)
  assert.deepEqual(run.room().stages.map(stage => stage.state), ['passed', 'passed', 'active'])
  assert.equal(run.messages.length, 0)
})

test('rewind rejects pending, decision and non-git targets', async () => {
  const run = harness()
  const pendingRoom = {
    ...run.room(),
    stages: run.room().stages.map((stage, index) => (index === 2 ? { ...stage, state: 'pending' } : stage)),
  }
  assert.equal((await run.rewind(pendingRoom, { stage: 2 })).reason, 'conflict')
  assert.equal((await run.rewind(run.room(), { stage: 0 })).reason, 'invalid')
  const nonGit = harness({
    provider: () => ({ capabilities: () => ({ vcs: 'direct' }) }),
  })
  const result = await nonGit.rewind(nonGit.room(), { stage: 1 })
  assert.equal(result.reason, 'conflict')
  assert.match(result.error, /不支持回退代码/)
})
