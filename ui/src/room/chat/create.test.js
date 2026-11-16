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
