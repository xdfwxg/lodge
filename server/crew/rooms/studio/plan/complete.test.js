import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoomCompleter } from './complete.js'

const setup = () => {
  const messages = []
  const assignments = []
  let wrote = false
  let room = {
    id: 'room-1',
    goal: '交付一个结果',
    demo: false,
    stages: [{ title: '实现', kind: 'deliverable', state: 'passed' }],
    workRound: {
      id: 'round-1',
      goal: '交付一个结果',
      status: 'active',
      stages: [{ title: '实现', kind: 'deliverable', state: 'passed', activatedAt: 100 }],
    },
  }
  const store = {
    readMessages: () => messages,
    readAssignments: () => assignments,
    appendMessage: (_roomId, message) => {
      const stored = { id: `m${messages.length + 1}`, ...message }
      messages.push(stored)
      return stored
    },
    appendEvent: () => {},
    readAssignment: id => assignments.find(item => item.id === id) ?? null,
    updateAssignment: (id, mutate) => {
      const assignment = assignments.find(item => item.id === id)
      if (assignment === undefined) return null
      const change = mutate(assignment)
      if (change === null || change === undefined || change === false) return null
      Object.assign(assignment, change === true ? {} : change)
      return assignment
    },
    finishWorkRound: ({ status, patch = {}, message = null }) => {
      room = { ...room, ...patch, workRound: { ...room.workRound, status } }
      const stored = message === null
        ? null
        : { id: `m${messages.length + 1}`, ...message, workRoundId: room.workRound.id }
      if (stored !== null) messages.push(stored)
      return { round: room.workRound, room, message: stored }
    },
  }
  const completeRoom = createRoomCompleter({
    store,
    emit: () => {},
    roomFiles: { writeConclusion: () => { wrote = true } },
    workspace: { provider: () => ({ capabilities: () => ({ commit: false, vcs: 'none' }) }) },
  }).completeRoom
  return {
    assignments,
    messages,
    completeRoom,
    room: () => room,
    wrote: () => wrote,
  }
}

test('a blocked handoff keeps the delivery conclusion out of the room', () => {
  const ctx = setup()
  ctx.assignments.push({ id: 'as-work', reason: 'dispatch', status: 'sent' })
  const done = ctx.completeRoom(ctx.room())
  assert.equal(done.workRound.status, 'active')
  assert.equal(ctx.messages.filter(message => message.kind === 'conclusion').length, 0)
  assert.equal(ctx.wrote(), false)
  assert.ok(ctx.messages.some(message => /还有交接没有收口/.test(message.text ?? '')))
})

test('a summary handoff closes once and the delivery conclusion is written once', () => {
  const ctx = setup()
  ctx.assignments.push({ id: 'as-summary', reason: 'summary', status: 'sent' })
  const first = ctx.completeRoom(ctx.room())
  assert.equal(first.workRound.status, 'completed')
  assert.equal(ctx.assignments[0].status, 'passed')
  assert.equal(ctx.messages.filter(message => message.kind === 'conclusion').length, 1)
  assert.equal(ctx.wrote(), true)

  const second = ctx.completeRoom(ctx.room())
  assert.equal(second.workRound.status, 'completed')
  assert.equal(ctx.messages.filter(message => message.kind === 'conclusion').length, 1)
})
