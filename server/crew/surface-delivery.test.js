import assert from 'node:assert/strict'
import test from 'node:test'
import { createBaseSurface } from './surfaces/base.js'
import { createEchoSurface } from './surfaces/echo.js'
import { createSurfaceRegistry } from './surface-port.js'
import { deliverToSeat } from './surface-delivery.js'

const room = (surface = { kind: 'echo' }) => ({
  id: 'room-1',
  chatRoom: { id: 'chat-1' },
  seatNames: { worker: '执行官' },
  seatBots: { worker: 'member-1' },
  seatSpecs: [
    { id: 'planner', name: '规划师' },
    { id: 'worker', name: '执行官', surface },
  ],
})

const setup = (current = room()) => {
  const echo = createEchoSurface()
  const engine = {
    sendTurn: async () => {
      throw new Error('echo 席位不应调用基座')
    },
  }
  const store = { readRoom: () => current }
  const surfaces = createSurfaceRegistry({
    surfaces: [createBaseSurface({ engine }), echo],
  })
  return { echo, engine, store, surfaces }
}

test('a seat bound to echo gets the same envelope without touching the base', async () => {
  const ctx = setup()
  const result = await deliverToSeat({
    engine: ctx.engine,
    store: ctx.store,
    roomId: 'room-1',
    seat: 'worker',
    surfaces: ctx.surfaces,
    text: '开始这一步',
    sendId: 'echo-0001',
    from: 'planner',
  })

  assert.equal(result.echo, true)
  assert.deepEqual(ctx.echo.deliveries[0], {
    roomId: 'room-1',
    seat: 'worker',
    text: '[来自 规划师 · 阶段交接 · 按你的角色执行]\n开始这一步',
    sendId: 'echo-0001',
    intent: 'handoff',
    from: 'planner',
  })
})

test('a seat with an unknown surface fails closed', async () => {
  const ctx = setup(room({ kind: 'robot' }))
  await assert.rejects(
    () => deliverToSeat({
      engine: ctx.engine,
      store: ctx.store,
      roomId: 'room-1',
      seat: 'worker',
      surfaces: ctx.surfaces,
      text: '开始',
    }),
    /没有 robot 类型的 surface/,
  )
  assert.equal(ctx.echo.deliveries.length, 0)
})

test('the surface port carries hold and cancel as room operations', async () => {
  const ctx = setup()
  const surface = ctx.surfaces.of(room(), 'worker')
  assert.equal(surface.capabilities().hold, true)
  await surface.hold({ roomId: 'chat-1', seat: 'worker', held: true })
  assert.equal(surface.state({ roomId: 'chat-1', seat: 'worker' }).held, true)
  await surface.cancel({ roomId: 'chat-1', queueId: 'queue-1' })
  assert.deepEqual(ctx.echo.operations.map(item => item.op), ['hold', 'cancel'])
})
