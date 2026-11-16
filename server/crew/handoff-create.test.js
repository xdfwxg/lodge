import assert from 'node:assert/strict'
import test from 'node:test'
import { alignmentPrompt, directPrompt, normalizeRequest } from './rooms/create/input.js'
import { roomBulletin } from './rooms/kinds.js'

const handoff = {
  topic: '发布检查清单',
  consensus: ['三组检查'],
  disagreements: ['是否自动回滚'],
  constraints: ['单文件'],
  todos: ['写初稿'],
}

test('room creation accepts a five-field handoff and bounds it', () => {
  const result = normalizeRequest({
    goal: '做发布检查清单',
    roomType: 'studio',
    verify: 'manual',
    handoff: {
      topic: '发布检查清单',
      consensus: ['三组检查'],
      disagreements: ['是否自动回滚'],
      constraints: ['单文件'],
      todos: ['写初稿'],
    },
  })
  assert.deepEqual(result.handoff, {
    topic: '发布检查清单',
    consensus: ['三组检查'],
    disagreements: ['是否自动回滚'],
    constraints: ['单文件'],
    todos: ['写初稿'],
  })
})

test('the handoff is part of the bulletin and the opening prompt', () => {
  const bulletin = roomBulletin('发布检查清单', 'manual', '', handoff)
  assert.match(bulletin, /交接单/)
  assert.match(bulletin, /共识：三组检查/)
  assert.match(bulletin, /待办：写初稿/)

  const aligned = alignmentPrompt('甲', '发布检查清单', 'manual', '', handoff)
  assert.match(aligned, /交接单/)
  assert.match(aligned, /分歧：是否自动回滚/)

  const direct = directPrompt('发布检查清单', 'manual', '', true, handoff)
  assert.match(direct, /交接单/)
  assert.match(direct, /约束：单文件/)
})

test('without a handoff the opening prompt stays short', () => {
  assert.doesNotMatch(roomBulletin('发布检查清单', 'manual', ''), /交接单/)
})

test('an empty handoff is not stored', () => {
  const result = normalizeRequest({
    goal: '做发布检查清单',
    roomType: 'studio',
    verify: 'manual',
    handoff: { topic: '', consensus: [], disagreements: [], constraints: [], todos: [] },
  })
  assert.equal(result.handoff, null)
})
