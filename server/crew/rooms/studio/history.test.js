import assert from 'node:assert/strict'
import test from 'node:test'
import { historyBriefOf } from './history.js'

const room = {
  id: 'room-1',
  members: [{ id: 'worker', name: '甲' }],
}

test('room history is clipped, attributed and marked read-only', () => {
  const store = {
    searchMessages: () => [
      { id: 'm1', authorId: 'worker', ts: Date.UTC(2026, 6, 12, 6, 3), text: '上次选拼音是因为跨平台，不用再问一遍。' },
      { id: 'm2', authorId: 'you', ts: Date.UTC(2026, 6, 12, 6, 5), text: '方案' + '很长'.repeat(200) },
    ],
  }
  const brief = historyBriefOf({ store, room, query: '为什么选拼音', before: 2 })
  assert.match(brief, /相关历史（本房间，只读/)
  assert.match(brief, /甲：上次选拼音/)
  assert.match(brief, /你：/)
  assert.match(brief, /…/)
  assert.equal(brief.split('\n').length, 3)
})

test('no hits or no index means no block', () => {
  assert.equal(historyBriefOf({ store: { searchMessages: () => [] }, room, query: 'x' }), '')
  assert.equal(historyBriefOf({ store: {}, room, query: 'x' }), '')
})
