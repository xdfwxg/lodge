import assert from 'node:assert/strict'
import test from 'node:test'
import { historyBriefOf } from './history-brief.js'

const room = {
  id: 'room-1',
  members: [{ id: 'worker', name: '甲' }],
}

test('room history is clipped, attributed and marked read-only', () => {
  const store = {
    searchMessages: () => [
      { id: 'm1', authorId: 'worker', ts: Date.UTC(2026, 6, 12, 6, 3), text: '上次选拼音是因为跨平台，不用再问一遍。' },
      { id: 'm2', authorId: 'you', ts: Date.UTC(2026, 6, 12, 6, 5), text: '方案' + '很长'.repeat(200) },
      { id: 'm3', authorId: 'worker', ts: Date.UTC(2026, 6, 12, 6, 6), text: '上次\u200b选拼音' },
    ],
  }
  const brief = historyBriefOf({ store, room, query: '为什么选拼音', before: 2 })
  assert.match(brief.text, /相关历史（本房间，只读/)
  assert.match(brief.text, /甲：上次选拼音/)
  assert.match(brief.text, /你：/)
  assert.match(brief.text, /…/)
  assert.doesNotMatch(brief.text, /\u200b/)
  assert.equal(brief.text.split('\n').length, 4)
  assert.deepEqual(brief.messageIds, ['m1', 'm2', 'm3'])
})

test('no hits or no index means no block', () => {
  assert.deepEqual(historyBriefOf({ store: { searchMessages: () => [] }, room, query: 'x' }), { text: '', messageIds: [] })
  assert.deepEqual(historyBriefOf({ store: {}, room, query: 'x' }), { text: '', messageIds: [] })
})
