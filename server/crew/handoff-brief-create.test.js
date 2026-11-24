import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeRequest } from './rooms/create/input.js'
import { alignmentPrompt, directPrompt } from './rooms/create/prompts.js'
import { roomBulletin } from './rooms/kinds.js'

const handoffBrief = {
  topic: '发布检查清单',
  consensus: ['三组检查'],
  disagreements: ['是否自动回滚'],
  constraints: ['单文件'],
  todos: ['写初稿'],
}

test('room creation accepts a five-field handoffBrief and bounds it', () => {
  const result = normalizeRequest({
    goal: '做发布检查清单',
    roomType: 'studio',
    verify: 'manual',
    handoffBrief: {
      topic: '发布检查清单',
      consensus: ['三组检查'],
      disagreements: ['是否自动回滚'],
      constraints: ['单文件'],
      todos: ['写初稿'],
    },
  })
  assert.deepEqual(result.handoffBrief, {
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

test('the handoffBrief is part of the bulletin and the opening prompt', () => {
  const bulletin = roomBulletin('发布检查清单', 'manual', '', handoffBrief)
  assert.match(bulletin, /交接简报/)
  assert.match(bulletin, /共识：三组检查/)
  assert.match(bulletin, /待办：写初稿/)

  const aligned = alignmentPrompt('发布检查清单', 'manual', '', handoffBrief)
  assert.match(aligned, /交接简报/)
  assert.match(aligned, /分歧：是否自动回滚/)
  // 对齐回合提交方案和队伍，不再手写一份计划再 @ 下一位。
  assert.match(aligned, /lodge_gate_submit_plan/)
  assert.match(aligned, /工作包/)
  assert.match(aligned, /执行官和验收员/)
  assert.match(aligned, /不要 @ 任何人/)
  assert.match(aligned, /平台会校验/)
  assert.doesNotMatch(aligned, /系统会把计划交给执行官/)

  const direct = directPrompt('发布检查清单', 'manual', '', true, handoffBrief)
  assert.match(direct, /交接简报/)
  assert.match(direct, /约束：单文件/)
})

test('without a handoffBrief the opening prompt stays short', () => {
  assert.doesNotMatch(roomBulletin('发布检查清单', 'manual', ''), /交接简报/)
})

test('an empty handoffBrief is not stored', () => {
  const result = normalizeRequest({
    goal: '做发布检查清单',
    roomType: 'studio',
    verify: 'manual',
    handoffBrief: { topic: '', consensus: [], disagreements: [], constraints: [], todos: [] },
  })
  assert.equal(result.handoffBrief, null)
})

test('the alignment prompt asks the planner to submit a plan and crew', () => {
  const prompt = alignmentPrompt('发布检查清单', 'manual', '')
  assert.match(prompt, /lodge_gate_submit_plan/)
  assert.match(prompt, /阶段、工作包/)
  assert.match(prompt, /用户不选成员|不要 @ 任何人/)
  assert.match(prompt, /平台会校验、开通成员并开始第一步/)
  assert.doesNotMatch(prompt, /下一步做什么、交给谁/)
})
