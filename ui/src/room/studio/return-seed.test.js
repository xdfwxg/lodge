import assert from 'node:assert/strict'
import test from 'node:test'
import { returnToChatSeed } from './return-seed.js'

test('a finished delivery returns to chat as a structured receipt', () => {
  const seed = returnToChatSeed({
    id: 'room-studio',
    delivery: {
      name: '发布检查清单',
      goal: '让新人照着勾',
      stages: [{ state: 'passed' }, { state: 'passed' }],
      commands: [{ command: 'npm test', exit: 0 }, { command: 'npm run lint', exit: 0 }],
      changedFiles: ['RELEASE_CHECKLIST.md'],
      openQuestions: ['是否需要自动回滚？'],
    },
  })
  assert.equal(seed.goal, '评审这次交付：发布检查清单')
  assert.equal(seed.label, '这次交付')
  assert.equal(seed.sourceRoomId, 'room-studio')
  assert.deepEqual(seed.receipt, {
    result: '发布检查清单',
    completeness: '2/2 阶段完成，1 个文件',
    checks: ['2/2 项检查通过'],
    openQuestions: ['是否需要自动回滚？'],
  })
  assert.match(seed.conclusion, /完成度：2\/2 阶段完成/)
  assert.match(seed.conclusion, /检查：2\/2 项检查通过/)
  assert.match(seed.conclusion, /待确认：是否需要自动回滚？/)
})

test('a manual delivery still brings a receipt', () => {
  const seed = returnToChatSeed({
    id: 'room-manual',
    delivery: { name: '人工验收的交付', stages: [{ state: 'passed' }], commands: [], changedFiles: [] },
  })
  assert.equal(seed.receipt.completeness, '1/1 阶段完成')
  assert.deepEqual(seed.receipt.checks, ['人工验收通过'])
  assert.deepEqual(seed.receipt.openQuestions, [])
})

test('a room without a delivery cannot return to chat', () => {
  assert.equal(returnToChatSeed({ delivery: null }), null)
})
