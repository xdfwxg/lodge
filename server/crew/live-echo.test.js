import assert from 'node:assert/strict'
import test from 'node:test'
import { echoHumanMessage } from './live-chat.js'

const fakeStore = () => {
  const calls = []
  return {
    calls,
    upsertMessage: message => { calls.push({ kind: 'upsert', message }); return message },
    appendMessage: (roomId, message) => { calls.push({ kind: 'append', roomId, message }); return message },
  }
}

test('a sent message echoes into the room with the base message id', () => {
  const store = fakeStore()
  echoHumanMessage({ store, roomId: 'room-1', text: '现在进展如何？', messageId: 'm-1' })
  assert.equal(store.calls.length, 1)
  assert.equal(store.calls[0].kind, 'upsert')
  assert.equal(store.calls[0].message.id, 'm-1')
  assert.equal(store.calls[0].message.kind, 'chat')
  assert.equal(store.calls[0].message.authorId, 'you')
  assert.equal(store.calls[0].message.text, '现在进展如何？')
})

test('a sendId gives the echo a stable id before the base answers', () => {
  const store = fakeStore()
  echoHumanMessage({ store, roomId: 'room-1', text: '现在进展如何？', messageId: 'm-1', sendId: 'send-1234567890abcd' })
  assert.equal(store.calls[0].message.id, 'optimistic:send-1234567890abcd')
  assert.equal(store.calls[0].message.meta.sendId, 'send-1234567890abcd')
  assert.equal(store.calls[0].message.meta.echo, true)
})

test('a message without a base id still appears in the room', () => {
  const store = fakeStore()
  echoHumanMessage({ store, roomId: 'room-1', text: '稍等', messageId: null })
  assert.equal(store.calls.length, 1)
  assert.equal(store.calls[0].kind, 'append')
  assert.equal(store.calls[0].roomId, 'room-1')
  assert.equal(store.calls[0].message.text, '稍等')
})
