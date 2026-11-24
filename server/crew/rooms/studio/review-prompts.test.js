import assert from 'node:assert/strict'
import test from 'node:test'
import { verifierPromptOf } from './review-prompts.js'

const room = {
  id: 'room-1',
  goal: '把导出按钮做出来',
  plan: { done: ['导出按钮能用'] },
  stages: [{ title: '实现', kind: 'deliverable', state: 'active', deliverable: '导出按钮能用' }],
  members: [{ id: 'v', name: '验收员', role: 'verifier' }],
  worktrees: { v: '/tmp/worktree' },
}

test('a large diff keeps its beginning and tells the verifier to read the rest by file', () => {
  const changedFiles = Array.from({ length: 201 }, (_, index) => `src/file-${index}.js`)
  const diff = `diff --git a/src/file-0.js b/src/file-0.js\n${'+line\n'.repeat(8000)}TAIL-MARKER`
  const prompt = verifierPromptOf({
    room,
    stage: room.stages[0],
    stageIndex: 0,
    verifier: 'v',
    targets: ['v'],
    ids: ['v'],
    evidence: { id: 'e1' },
    meta: { diff, changedFiles },
    messages: [],
  })
  assert.match(prompt, /^.*diff --git a\/src\/file-0\.js/s)
  assert.match(prompt, /后面还有 \d+ 个字符没有放进提示/)
  assert.match(prompt, /按文件读全文/)
  assert.doesNotMatch(prompt, /TAIL-MARKER/)
  assert.match(prompt, /还有 1 个文件没有列出/)
  assert.match(prompt, /PASS 必须逐条覆盖/)
  assert.match(prompt, /PASS 之前必须亲手验过/)
})
