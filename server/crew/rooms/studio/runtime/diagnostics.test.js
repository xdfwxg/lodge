import assert from 'node:assert/strict'
import test from 'node:test'
import { createTurnDiagnostics } from './diagnostics.js'

const setup = (writer = true) => {
  let round = { stageDiagnostics: {} }
  const written = []
  const store = {
    updateRound: (id, mutate) => {
      const next = structuredClone(round)
      if (mutate(next) === null) return null
      round = next
      return round
    },
  }
  const write = createTurnDiagnostics({
    store,
    roomId: 'room-1',
    writeDiagnostic: writer
      ? (room, turnId, diagnostic) => written.push({ room, turnId, diagnostic })
      : undefined,
  })
  return { write, written, round: () => round }
}

const turn = { turnId: 't-1', at: 1_000, durationMs: 200, toolCalls: 2 }

test('a turn diagnostic records the facts and the stage summary', () => {
  const ctx = setup()
  ctx.write({
    room: { name: '工作室', stages: [{ title: '实现' }] },
    stageIndex: 0,
    memberId: 'worker',
    role: 'worker',
    turn,
    outcome: 'evidence',
    extra: { artifacts: 1 },
  })
  assert.equal(ctx.written.length, 1)
  assert.equal(ctx.written[0].turnId, 't-1')
  assert.equal(ctx.written[0].diagnostic.stageTitle, '实现')
  assert.equal(ctx.written[0].diagnostic.outcome, 'evidence')
  assert.equal(ctx.written[0].diagnostic.artifacts, 1)
  assert.equal(ctx.round().stageDiagnostics[0].outcome, 'evidence')
  assert.equal(ctx.round().stageDiagnostics[0].turnId, 't-1')
})

test('without a writer the diagnostic stays silent', () => {
  const ctx = setup(false)
  ctx.write({ room: { name: '工作室', stages: [] }, stageIndex: 0, memberId: 'a', role: 'worker', turn, outcome: 'empty' })
  assert.deepEqual(ctx.round().stageDiagnostics, {})
})

test('a writer failure does not break the turn', () => {
  const ctx = setup()
  assert.doesNotThrow(() => {
    createTurnDiagnostics({
      store: {
        updateRound: (id, mutate) => {
          const current = { stageDiagnostics: {} }
          mutate(current)
          return current
        },
      },
      roomId: 'room-1',
      writeDiagnostic: () => { throw new Error('disk full') },
    })({ room: { name: '工作室', stages: [] }, stageIndex: 0, memberId: 'a', role: 'worker', turn, outcome: 'captured' })
  })
})
