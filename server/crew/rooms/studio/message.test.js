import assert from 'node:assert/strict'
import test from 'node:test'
import { createStudioMessageHandler } from './message.js'

const room = { id: 'room-studio' }

const handler = ({ stage = 1, ok = true } = {}) => {
  const calls = []
  return {
    calls,
    run: createStudioMessageHandler({
      stages: {
        rework: async (input, args) => {
          calls.push({ input, args })
          return ok
            ? { ok: true, body: { room: { ...input, rewound: args.stage } } }
            : { ok: false, error: '不能重做' }
        },
      },
      readRoom: () => room,
      readMessages: () => [],
      humanHandoffStageOf: () => stage,
    }),
  }
}

test('a human handoff turns the next message into a rework of that stage', async () => {
  const ctx = handler()
  const result = await ctx.run(room, { text: '补一句边界' })
  assert.equal(result.ok, true)
  assert.equal(result.body.room.rewound, 1)
  assert.deepEqual(ctx.calls, [{ input: room, args: { stage: 1, note: '补一句边界' } }])
})

test('without a human handoff the message stays a normal message', async () => {
  const ctx = handler({ stage: null })
  assert.equal(await ctx.run(room, { text: '继续' }), null)
  assert.deepEqual(ctx.calls, [])
})

test('a rejected rework is returned instead of pretending the message was sent', async () => {
  const ctx = handler({ ok: false })
  const result = await ctx.run(room, { text: '补一句边界' })
  assert.equal(result.ok, false)
  assert.equal(result.error, '不能重做')
})
