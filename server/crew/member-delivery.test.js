import assert from 'node:assert/strict'
import test from 'node:test'
import { envelopeOf } from './member-delivery.js'
import { deliverToMember } from './surface-delivery.js'

const room = (over = {}) => ({
  id: 'room-1',
  chatRoom: { id: 'chat-1' },
  members: [
    { id: 'worker', name: '执行官', body: { kind: 'base', ref: 'member-1', name: 'Worker123' } },
    { id: 'lead', name: '规划师', body: { kind: 'base', ref: 'member-2', name: 'Planner123' } },
  ],
  ...over,
})

const setup = (current = room()) => {
  const calls = []
  return {
    calls,
    store: { readRoom: () => current },
    engine: {
      sendTurn: async input => {
        calls.push(input)
        return { messageId: 'm1' }
      },
    },
  }
}

test('delivery writes the address, harness envelope and stable member ref', async () => {
  const ctx = setup()
  await deliverToMember({
    engine: ctx.engine,
    store: ctx.store,
    roomId: 'room-1',
    memberId: 'worker',
    from: 'lead',
    sendId: 'test-delivery-0001',
    text: '开始这一步',
  })
  assert.deepEqual(ctx.calls[0], {
    roomId: 'chat-1',
    text: '@Worker123\n[来自 规划师 · 阶段交接 · 按你的角色执行]\n开始这一步',
    sendId: 'test-delivery-0001',
    mentions: ['member-1'],
  })
})

test('a room-facing name is already the address and is not prefixed twice', async () => {
  const ctx = setup(room({ members: [{ id: 'worker', name: '执行官', body: { kind: 'base', ref: 'member-1', name: '执行官' } }] }))
  await deliverToMember({
    engine: ctx.engine,
    store: ctx.store,
    roomId: 'room-1',
    memberId: 'worker',
    sendId: 'test-delivery-0002',
    text: '@执行官 开始这一步',
  })
  assert.equal(
    ctx.calls[0].text,
    '@执行官\n[来自 Lodge · 阶段交接 · 按你的角色执行]\n开始这一步',
  )
  assert.deepEqual(ctx.calls[0].mentions, ['member-1'])
})

test('the envelope names the intent and authority', () => {
  assert.equal(envelopeOf({ from: '验收流程', intent: 'decision' }), '[来自 验收流程 · 退回决定 · 只写你的决定和理由]')
  assert.equal(envelopeOf({ from: '规划师', intent: 'review' }), '[来自 规划师 · 复核 · 只读 · 只写结论]')
  assert.equal(envelopeOf({}), '[来自 Lodge · 阶段交接 · 按你的角色执行]')
})

test('the host is addressed by its own room name', async () => {
  const ctx = setup(room({ chatHost: { name: 'LodgeHost9', memberRef: 'host-1' } }))
  await deliverToMember({
    engine: ctx.engine,
    store: ctx.store,
    roomId: 'room-1',
    memberId: 'host',
    sendId: 'test-delivery-0003',
    text: '请总结这一轮',
  })
  assert.equal(
    ctx.calls[0].text,
    '@LodgeHost9\n[来自 Lodge · 阶段交接 · 按你的角色执行]\n请总结这一轮',
  )
  assert.deepEqual(ctx.calls[0].mentions, ['host-1'])
})

test('delivery fails closed when the member has no base address', async () => {
  const ctx = setup(room({ members: [{ id: 'worker', name: '执行官', body: { kind: 'base', name: '执行官' } }] }))
  await assert.rejects(
    () => deliverToMember({
      engine: ctx.engine,
      store: ctx.store,
      roomId: 'room-1',
      memberId: 'worker',
      text: '开始',
    }),
    /没有基座地址/,
  )
  assert.equal(ctx.calls.length, 0)
})
