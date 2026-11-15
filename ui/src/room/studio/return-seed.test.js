import assert from 'node:assert/strict'
import test from 'node:test'
import { returnToChatSeed } from './return-seed.js'

test('a finished delivery returns to chat as a compact review brief', () => {
  const seed = returnToChatSeed({
    delivery: {
      name: '发布检查清单',
      goal: '让新人照着勾',
      stages: [{ state: 'passed' }, { state: 'passed' }],
      commands: [{ exit: 0 }, { exit: 0 }],
      changedFiles: ['RELEASE_CHECKLIST.md'],
    },
  })
  assert.equal(seed.goal, '评审这次交付：发布检查清单')
  assert.equal(seed.label, '这次交付')
  assert.match(seed.conclusion, /2\/2 步/)
  assert.match(seed.conclusion, /2\/2 项通过/)
  assert.match(seed.conclusion, /1 个文件/)
  assert.match(seed.conclusion, /待确认/)
})

test('a room without a delivery cannot return to chat', () => {
  assert.equal(returnToChatSeed({ delivery: null }), null)
})
