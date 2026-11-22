import assert from 'node:assert/strict'
import test from 'node:test'
import { createLodgeActions } from './lodge.js'

const setup = intent => {
  const room = { id: 'lodge', lodge: true, state: 'active', live: true }
  const appended = []
  let created = null
  const actions = createLodgeActions({
    chat: { input: async () => ({ ok: true, body: { intent } }) },
    createRoom: async body => {
      created = body
      return { ok: true, body: { room: { id: 'new-room', name: body.name } } }
    },
    readRoom: () => room,
    appendMessage: (_roomId, message) => {
      appended.push(message)
      return { id: `m${appended.length}`, ...message }
    },
    emit: () => {},
    live: { isAttached: () => true },
  })
  return { actions, appended, created: () => created, room }
}

test('opening a room keeps the model goal instead of the last action phrase', async () => {
  const ctx = setup({
    action: 'open',
    room: 'chat',
    goal: '一起评价短篇《开锁》哪里好、哪里要改',
    reply: '那开间聊天室，让几个人一起读。',
  })
  const result = await ctx.actions.lodge({
    room: ctx.room,
    readBody: async () => ({ text: '找人一起评' }),
  })
  assert.equal(result.ok, true)
  assert.equal(ctx.created().goal, '一起评价短篇《开锁》哪里好、哪里要改')
  assert.equal(ctx.created().roomType, 'chat')
  assert.match(ctx.appended.at(-1).text, /开好了/)
})

test('an open intent without a goal falls back to the user text', async () => {
  const ctx = setup({ action: 'open', room: 'studio', goal: '', reply: '' })
  await ctx.actions.lodge({
    room: ctx.room,
    readBody: async () => ({ text: '写一个故事' }),
  })
  assert.equal(ctx.created().goal, '写一个故事')
  assert.equal(ctx.created().roomType, undefined)
})
