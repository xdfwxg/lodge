import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatRequest } from './create.js'

const base = {
  goal: '评审这次交付',
  name: '评审',
  repoPath: '',
  chatTurnLimit: 6,
  defaultMembers: [{ role: 'worker', name: '甲' }],
  choices: [],
  selectedModelOf: () => '',
}

test('a receipt and its source room travel with the chat request', () => {
  const receipt = {
    result: '发布检查',
    completeness: '2/2 阶段完成',
    checks: ['2/2 项检查通过'],
    openQuestions: [],
  }
  const request = buildChatRequest({
    ...base,
    receipt,
    sourceRoomId: 'room-studio',
    sourceName: '发布检查',
  })
  assert.deepEqual(request.receipt, receipt)
  assert.equal(request.sourceRoomId, 'room-studio')
  assert.equal(request.sourceName, '发布检查')
})

test('a plain chat request has no receipt or source', () => {
  const request = buildChatRequest(base)
  assert.equal('receipt' in request, false)
  assert.equal('sourceRoomId' in request, false)
  assert.equal('sourceName' in request, false)
})

test('a chat request keeps each member stance and speaking habit', () => {
  const request = buildChatRequest({
    ...base,
    defaultMembers: [
      { role: 'worker', name: '甲', stance: 'proposer', voice: '先问代价。' },
      { role: 'worker', name: '乙' },
    ],
    choices: [{ engine: '', model: '', voice: '先问代价，再问能不能落地。' }],
  })
  assert.equal(request.members[0].voice, '先问代价，再问能不能落地。')
  assert.equal(request.members[0].stance, 'proposer')
  // 自定义成员没有立场时按顺序补一个，标签和排序才不会缺位。
  assert.equal(request.members[1].stance, 'critic')
  assert.equal('voice' in request.members[1], false)
})
