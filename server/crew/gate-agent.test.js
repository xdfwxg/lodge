import assert from 'node:assert/strict'
import test from 'node:test'
import { createGateAgent } from './gate-agent.js'

const room = {
  name: '测试房间',
  goal: '验证独立守门',
  repoPath: '/tmp',
  constraints: [],
  seatSpecs: [{ id: 'worker', role: 'worker' }],
}
const approval = {
  seat: 'worker',
  seatName: '执行',
  kind: 'privilege',
  summary: 'sudo rm -rf /tmp/x',
  gate: { decision: 'deny', reasons: ['提权命令'] },
}

const engine = overrides => {
  const calls = []
  const base = {
    capabilities: () => ({ provisioning: true }),
    createSeatBot: async () => ({ id: 'gate-bot', name: 'Gate', engine: 'codex-1', model: 'm' }),
    createRoom: async () => ({ id: 'gate-room', sessionRef: 'gate-thread' }),
    sendTurn: async () => ({ accepted: true }),
    history: async () => ({
      messages: [{
        kind: 'turn',
        turn: { reply: '```json\n{"decision":"deny","reasons":["提权命令"]}\n```' },
      }],
    }),
    deleteRoom: async id => calls.push(['room', id]),
    deleteSeatBot: async id => calls.push(['seat', id]),
    ...overrides,
  }
  return { engine: base, calls }
}

test('the model gate returns an independent recommendation and cleans up', async () => {
  const { engine: fake, calls } = engine()
  const agent = createGateAgent({ engine: fake })
  const result = await agent.review({ room, approval })
  assert.equal(result.decision, 'deny')
  assert.equal(result.risk, 'high')
  assert.equal(result.context, 'independent-model')
  assert.deepEqual(result.reasons, ['提权命令'])
  assert.deepEqual(calls, [['room', 'gate-room'], ['seat', 'gate-bot']])
})

test('the model gate can be disabled or fail soft', async () => {
  const disabled = createGateAgent({ engine: engine().engine, enabled: false })
  assert.equal(await disabled.review({ room, approval }), null)

  const { engine: failing } = engine({ createRoom: async () => { throw new Error('runtime down') } })
  const result = await createGateAgent({ engine: failing }).review({ room, approval })
  assert.equal(result.decision, 'review')
  assert.equal(result.error, true)
  assert.match(result.reasons[0], /runtime down/)
})
