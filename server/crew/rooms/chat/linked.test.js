import assert from 'node:assert/strict'
import test from 'node:test'
import { linkedRoomBriefs } from './linked.js'

const setup = () => {
  const parent = { id: 'lodge', name: 'Lodge', lodge: true, roomType: 'chat', state: 'active' }
  const chat = {
    id: 'chat-child', name: '评价故事', goal: '一起评价短篇《开锁》',
    roomType: 'chat', state: 'active', sourceRoomId: 'lodge',
    chat: { phase: 'concluded' },
  }
  const studio = {
    id: 'studio-child', name: '改结尾', goal: '把结尾改好',
    roomType: 'studio', state: 'idle', sourceRoomId: 'lodge',
    workRound: { id: 'r1', status: 'completed' },
  }
  const archived = {
    id: 'archived-child', name: '旧房', roomType: 'chat', state: 'idle',
    archivedAt: 1, sourceRoomId: 'lodge',
  }
  const messageChild = {
    id: 'message-child', name: '消息链接房', goal: '从开房消息进来的房',
    roomType: 'chat', state: 'active', chat: { phase: 'concluded' },
  }
  const rooms = new Map([parent, chat, studio, archived, messageChild].map(room => [room.id, room]))
  const messages = new Map([
    [parent.id, [{ id: 'm1', kind: 'chat', meta: { openRoomId: 'message-child' } }]],
    [chat.id, [{ id: 'm2', kind: 'chat_conclusion', text: '故事的开头好，结尾收得太急。' }]],
    [studio.id, [{ id: 'm3', kind: 'conclusion', text: '已交付：改结尾' }]],
  ])
  const store = {
    readRooms: () => [...rooms.values()],
    readRoom: id => rooms.get(id) ?? null,
    readMessages: id => messages.get(id) ?? [],
  }
  return { parent, store }
}

test('the host sees linked rooms and their last conclusion', () => {
  const { parent, store } = setup()
  const briefs = linkedRoomBriefs({ store, room: parent })
  assert.deepEqual(briefs.map(item => [item.name, item.status]), [
    ['评价故事', '已有结论'],
    ['改结尾', '已交付'],
    ['消息链接房', '已有结论'],
  ])
  assert.match(briefs[0].conclusion, /结尾收得太急/)
  assert.match(briefs[1].conclusion, /已交付/)
  assert.equal(briefs.some(item => item.name === '旧房'), false)
})

test('linked rooms cap at three and skip the parent', () => {
  const { parent, store } = setup()
  const briefs = linkedRoomBriefs({ store, room: parent, limit: 2 })
  assert.equal(briefs.length, 2)
  assert.equal(briefs.some(item => item.id === 'lodge'), false)
})

const linkedStore = (rooms, messages) => {
  const byId = new Map(rooms.map(item => [item.id, item]))
  return {
    readRooms: () => rooms,
    readRoom: id => byId.get(id) ?? null,
    readMessages: id => messages[id] ?? [],
  }
}

const child = (id, extra = {}) => ({
  id,
  name: id,
  roomType: 'chat',
  state: 'active',
  chat: { phase: 'concluded' },
  ...extra,
})

test('opening messages and child source ids name the same recent rooms once', () => {
  const parent = { id: 'lodge', name: 'Lodge', lodge: true, roomType: 'chat', state: 'active' }
  const rooms = [
    parent,
    child('d1', { sourceRoomId: 'lodge' }),
    child('d2', { sourceRoomId: 'lodge' }),
    child('d3', { sourceRoomId: 'lodge' }),
    child('d4', { sourceRoomId: 'lodge' }),
    child('message-child'),
  ]
  const messages = {
    lodge: [
      { id: 'm1', kind: 'chat', meta: { openRoomId: 'message-child' } },
      { id: 'm2', kind: 'chat', meta: { openRoomId: 'd3' } },
    ],
  }
  const briefs = linkedRoomBriefs({ store: linkedStore(rooms, messages), room: parent, limit: 3 })
  assert.deepEqual(briefs.map(item => item.id), ['d3', 'd4', 'message-child'])
})

test('the brief keeps the newest three children across both records', () => {
  const parent = { id: 'lodge', name: 'Lodge', lodge: true, roomType: 'chat', state: 'active' }
  const rooms = [
    parent,
    child('oldest', { sourceRoomId: 'lodge' }),
    child('opened-1'),
    child('opened-2'),
    child('opened-3'),
    child('newest', { sourceRoomId: 'lodge' }),
  ]
  const messages = {
    lodge: ['opened-1', 'opened-2', 'opened-3'].map((id, index) => ({
      id: `m${index}`,
      kind: 'chat',
      meta: { openRoomId: id },
    })),
  }
  const briefs = linkedRoomBriefs({ store: linkedStore(rooms, messages), room: parent, limit: 3 })
  assert.deepEqual(briefs.map(item => item.id), ['opened-2', 'opened-3', 'newest'])
})
