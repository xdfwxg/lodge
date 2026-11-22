import test from 'node:test'
import assert from 'node:assert/strict'
import { pickChatRoom } from './eval-chat-room.mjs'

const member = ref => ({ id: 'worker', name: '甲', body: { kind: 'base', ref } })
const chatRoom = (id, extra = {}) => ({
  id,
  roomType: 'chat',
  lodge: false,
  live: true,
  members: [member(`ref-${id}`)],
  ...extra,
})

test('chat probe skips the Lodge host and rooms without member bots', () => {
  const rooms = [
    { id: 'room-lodge', roomType: 'chat', lodge: true, live: true, members: [] },
    { id: 'empty-chat', roomType: 'chat', live: true, members: [] },
    { id: 'studio', roomType: 'studio', live: true, members: [member('ref-studio')] },
    chatRoom('live-chat'),
  ]
  assert.equal(pickChatRoom(rooms).room.id, 'live-chat')
})

test('chat probe still accepts a stopped chat room when no live one is usable', () => {
  const rooms = [
    { id: 'room-lodge', roomType: 'chat', lodge: true, live: true, members: [] },
    chatRoom('stopped-chat', { live: false }),
  ]
  assert.equal(pickChatRoom(rooms).room.id, 'stopped-chat')
})

test('chat probe explains missing rooms and member bots', () => {
  assert.match(pickChatRoom([], undefined).error, /没有用于评测的聊天室/)
  assert.match(pickChatRoom([], 'room-missing').error, /找不到房间 room-missing/)
  assert.match(
    pickChatRoom([{ id: 'empty-chat', roomType: 'chat', members: [] }], 'empty-chat').error,
    /没有成员 bot/,
  )
})
