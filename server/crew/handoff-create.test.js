import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeRequest } from './rooms/create/input.js'
import { alignmentPrompt, directPrompt } from './rooms/create/prompts.js'
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

test('browser research is system-wide, not a room request field', () => {
  const request = normalizeRequest({ goal: '查机票', verify: 'manual', browser: true, roomAccess: 'allow' })
  assert.equal('browser' in request, false)
  assert.equal('roomAccess' in request, false)
})

test('the handoff is part of the bulletin and the opening prompt', () => {
  const bulletin = roomBulletin('发布检查清单', 'manual', '', handoff)
  assert.match(bulletin, /交接单/)
  assert.match(bulletin, /共识：三组检查/)
  assert.match(bulletin, /待办：写初稿/)

  const aligned = alignmentPrompt('发布检查清单', 'manual', '', handoff)
  assert.match(aligned, /交接单/)
  assert.match(aligned, /分歧：是否自动回滚/)
  // 对齐回合只回三行计划，不铺内部阶段。
  assert.match(aligned, /\*\*做什么：\*\*/)
  assert.doesNotMatch(aligned, /\*\*口径：\*\*/)
  assert.match(aligned, /\*\*怎么验收：\*\*/)
  assert.match(aligned, /\*\*做完是什么样：\*\*/)
  assert.doesNotMatch(aligned, /不超过 12 行/)
  assert.doesNotMatch(aligned, /不要用行内代码包中文标签/)
  assert.match(aligned, /系统会把计划交给执行官/)

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

test('the alignment prompt asks for three lines, not internal stages', () => {
  const prompt = alignmentPrompt('发布检查清单', 'manual', '')
  assert.match(prompt, /\*\*做什么：\*\*/)
  assert.match(prompt, /\*\*怎么验收：\*\*/)
  assert.match(prompt, /\*\*做完是什么样：\*\*/)
  assert.doesNotMatch(prompt, /目标对齐/)
})
