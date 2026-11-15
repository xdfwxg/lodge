import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeRequest } from './rooms/create/input.js'

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

test('an empty handoff is not stored', () => {
  const result = normalizeRequest({
    goal: '做发布检查清单',
    roomType: 'studio',
    verify: 'manual',
    handoff: { topic: '', consensus: [], disagreements: [], constraints: [], todos: [] },
  })
  assert.equal(result.handoff, null)
})
