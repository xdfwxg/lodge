import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatScheduler } from './scheduler.js'

// 复核回复不是发言：调度器要在窗口内丢掉它，并把回合 id 留给投影层。
const setup = ({ reply = { text: 'PASS\n没有超出讨论记录。', turnId: 'turn-r' } } = {}) => {
  const room = {
    id: 'room-chat',
    roomType: 'chat',
    state: 'active',
    goal: '聊一部剧',
    members: [{ id: 'worker-2', name: '小林', body: { kind: 'base', ref: 'bot-2' } }],
    chat: { round: 1, phase: 'concluded', turnLimit: 5, turns: 3, running: false, reviewing: null, hiddenTurns: [] },
  }
  const syncs = []
  const store = {
    readRoom: () => room,
    readMessages: () => [],
    updateRoom: (id, mutate) => {
      const next = structuredClone(room)
      if (mutate(next) === null) return null
      Object.assign(room, next)
      return room
    },
  }
  const scheduler = createChatScheduler({
    store,
    transport: {
      ready: () => true,
      messageIds: async () => new Set(['p-1']),
      findReply: async () => reply,
    },
    sendToMember: async () => ({ messageId: 'prompt-1' }),
    roomId: room.id,
    syncChat: async () => {
      syncs.push(room.chat.reviewing)
    },
    waitMs: 20,
    pollMs: 1,
  })
  return { scheduler, room, syncs }
}

test('a conclusion review keeps the reply out of the timeline', async () => {
  const { scheduler, room, syncs } = setup()
  const result = await scheduler.reviewConclusion({
    room,
    reviewerId: 'worker-2',
    conclusion: '这轮卡在定位这一步。',
  })
  assert.equal(result.text, 'PASS\n没有超出讨论记录。')
  // 同步发生在窗口内，回复被投影丢掉；回合 id 留给迟到的事件。
  assert.deepEqual(syncs, ['worker-2'])
  assert.equal(room.chat.reviewing, null)
  assert.deepEqual(room.chat.hiddenTurns, ['turn-r'])
  assert.ok(room.hiddenBaseMessages.includes('prompt-1'))
})

test('a review that never answers closes its window', async () => {
  const { scheduler, room } = setup({ reply: null })
  await assert.rejects(
    () => scheduler.reviewConclusion({ room, reviewerId: 'worker-2', conclusion: '结论' }),
    /没有在限定时间内回答/,
  )
  assert.equal(room.chat.reviewing, null)
  assert.deepEqual(room.chat.hiddenTurns, [])
})
