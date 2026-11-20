import assert from 'node:assert/strict'
import test from 'node:test'
import { systemNotice } from './notices.js'

const capture = () => {
  let message = null
  return {
    store: { appendMessage: (roomId, value) => (message = value) },
    read: () => message,
  }
}

test('a retry or reconnect notice stays visible as a quiet status', () => {
  const fake = capture()
  systemNotice({ store: fake.store, roomId: 'r', text: '连接还没接上；稍后重试会自动连上。' })
  assert.equal(fake.read().meta.kind, 'notice')
  assert.equal(fake.read().meta.show, true)
})

test('background advice that affects nothing stays out of the timeline', () => {
  const fake = capture()
  systemNotice({ store: fake.store, roomId: 'r', text: '影子评审这次没取到；验收不受影响。' })
  assert.equal(fake.read().meta.show, false)
})

test('a failure that needs the user is visible and keeps the raw detail out of the line', () => {
  const fake = capture()
  systemNotice({ store: fake.store, roomId: 'r', text: '重做没能开始；需要你处理。', error: new Error('boom') })
  assert.equal(fake.read().meta.show, true)
  assert.equal(fake.read().text, '重做没能开始；需要你处理。')
  assert.equal(fake.read().meta.detail, 'boom')
})
