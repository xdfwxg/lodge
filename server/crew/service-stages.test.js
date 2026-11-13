import assert from 'node:assert/strict'
import test from 'node:test'
import { createServiceStages } from './service-stages.js'

const room = (over = {}) => ({
  id: 'room-1',
  kind: 'room',
  state: 'active',
  live: true,
  demo: false,
  busy: false,
  openQuestion: null,
  verifiers: [],
  workers: ['worker'],
  seatNames: { worker: '执行者' },
  usage: { costMicroUsd: 0, budgetMicroUsd: 0 },
  stages: [
    { title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test', tasks: [] },
    { title: '验收与结论', kind: 'decision', state: 'pending' },
  ],
  ...over,
})

const setup = initial => {
  let current = initial
  const messages = []
  const store = {
    readRooms: () => [current],
    readMessages: () => messages,
    updateRoom: (id, mutate) => {
      const next = structuredClone(current)
      if (mutate(next) === null) return null
      current = next
      return current
    },
    appendMessage: (id, message) => {
      const stored = { id: `m-${messages.length + 1}`, seq: messages.length + 1, ...message }
      messages.push(stored)
      return stored
    },
  }
  const calls = []
  const stages = createServiceStages({
    store,
    live: {
      reworkStage: async (target, index, note) => { calls.push({ target, index, note }) },
      isAttached: () => true,
      resume: async (id, options) => { calls.push({ resume: id, options }) },
    },
    emit: () => {},
    completeRoom: value => value,
    roomFiles: { writeGoal: () => {} },
  })
  return { store, stages, room: () => current, messages, calls }
}

test('changing the acceptance command reruns it, but an unchanged save does not', () => {
  const ctx = setup(room())
  const changed = ctx.stages.setAcceptance(ctx.room(), 0, 'npm run check')
  assert.equal(changed.ok, true)
  const resumes = ctx.calls.filter(call => call.resume !== undefined)
  assert.equal(resumes.length, 1)
  assert.equal(resumes[0].options.forceAcceptance, true)
  const unchanged = ctx.stages.setAcceptance(ctx.room(), 0, 'npm run check')
  assert.equal(unchanged.ok, true)
  assert.equal(ctx.calls.filter(call => call.resume !== undefined).length, 1)
})

test('rework records the human objection and re-dispatches the active stage', async () => {
  const ctx = setup(room())
  const result = await ctx.stages.rework(ctx.room(), { stage: 0, note: '方向不对' })
  assert.equal(result.ok, true)
  assert.equal(ctx.messages.at(-1).kind, 'rework')
  assert.equal(ctx.messages.at(-1).text, '方向不对')
  assert.equal(ctx.calls.length, 1)
  assert.equal(ctx.calls[0].index, 0)
  assert.equal(ctx.calls[0].note, '方向不对')
})

test('accepting a stage writes a conclusion card for the next step', () => {
  const ctx = setup(room({ live: false }))
  ctx.messages.push({ id: 'e-1', seq: 1, kind: 'evidence', meta: { stage: 0, kind: 'command', command: 'npm test', exit: 0 } })
  const result = ctx.stages.accept(ctx.room(), { stage: 0 })
  assert.equal(result.ok, true)
  const conclusion = ctx.messages.find(message => message.kind === 'stage_conclusion')
  assert.equal(conclusion.meta.stage, 0)
  assert.equal(conclusion.meta.command, 'npm test')
  assert.equal(conclusion.meta.next, '验收与结论')
})

test('studio signoff records a human Verifier verdict and moves closure', () => {
  const ctx = setup(room({
    live: false,
    roomType: 'studio',
    closure: 'verifying',
    verificationMode: 'hybrid',
    verifiers: ['verifier'],
    stages: [
      { title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test', tasks: [] },
      { title: '验收与结论', kind: 'decision', state: 'pending' },
    ],
  }))
  ctx.messages.push({ id: 'e-1', seq: 1, kind: 'evidence', meta: { stage: 0, kind: 'command', command: 'npm test', exit: 0 } })
  ctx.messages.push({ id: 'v-1', seq: 2, kind: 'verdict', authorId: 'verifier', meta: { stage: 0, pass: true, evidenceId: 'e-1' } })
  const result = ctx.stages.accept(ctx.room(), { stage: 0 })
  assert.equal(result.ok, true)
  const human = ctx.messages.find(message => message.kind === 'verdict' && message.authorId === 'you')
  assert.equal(human.meta.roleKind, 'verifier')
  assert.equal(human.meta.mode, 'human')
  assert.equal(ctx.room().closure, 'verifying')
})

test('the final conclusion signs only after a recorded Verifier PASS', () => {
  const ctx = setup(room({
    live: false,
    roomType: 'studio',
    closure: 'verifying',
    verificationMode: 'hybrid',
    verifiers: ['verifier'],
    stages: [
      { title: '实现', kind: 'deliverable', state: 'passed', acceptance: 'npm test', tasks: [] },
      { title: '验收与结论', kind: 'decision', state: 'active' },
    ],
  }))
  ctx.messages.push({ id: 'e-1', seq: 1, kind: 'evidence', meta: { stage: 0, kind: 'command', command: 'npm test', exit: 0 } })
  ctx.messages.push({ id: 'v-1', seq: 2, kind: 'verdict', authorId: 'verifier', meta: { stage: 0, pass: true, evidenceId: 'e-1' } })
  const result = ctx.stages.accept(ctx.room(), { stage: 1 })
  assert.equal(result.ok, true)
  assert.equal(ctx.room().closure, 'signed')
  assert.equal(ctx.room().state, 'complete')
})

test('a studio cannot sign without a Verifier PASS', () => {
  const ctx = setup(room({
    live: false,
    roomType: 'studio',
    closure: 'verifying',
    verificationMode: 'hybrid',
    verifiers: ['verifier'],
    stages: [{ title: '验收与结论', kind: 'decision', state: 'active' }],
  }))
  const result = ctx.stages.accept(ctx.room(), { stage: 0 })
  assert.equal(result.ok, false)
  assert.match(result.error, /Verifier/)
  assert.equal(ctx.room().closure, 'verifying')
})
