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
    meta: {
      diff,
      changedFiles,
      proof: { entry: 'npm test', status: 'failed', exit: 1, output: '1 failing' },
    },
    messages: [],
  })
  assert.match(prompt, /^.*diff --git a\/src\/file-0\.js/s)
  assert.match(prompt, /后面还有 \d+ 个字符没有放进提示/)
  assert.match(prompt, /按文件读全文/)
  assert.doesNotMatch(prompt, /TAIL-MARKER/)
  assert.match(prompt, /还有 1 个文件没有列出/)
  assert.match(prompt, /PASS 必须逐条覆盖/)
  assert.match(prompt, /PASS 之前必须亲手验过/)
  assert.match(prompt, /平台执行了交付自带的证明/)
  assert.match(prompt, /入口：npm test/)
  assert.match(prompt, /状态：failed · 退出码 1/)
  assert.match(prompt, /1 failing/)
})

test('the contract boundaries, non-goals and assumptions reach the verifier too', () => {
  const contractRoom = {
    ...room,
    plan: {
      done: ['导出按钮能用'],
      contract: {
        version: 1,
        outcomes: [{ id: 'export', statement: '导出按钮能用', observable: '点击后下载文件' }],
        boundaries: ['不改接口'],
        nonGoals: ['不加批量导出'],
        assumptions: ['浏览器支持下载'],
      },
    },
  }
  const prompt = verifierPromptOf({
    room: contractRoom,
    stage: contractRoom.stages[0],
    stageIndex: 0,
    verifier: 'v',
    targets: ['v'],
    ids: ['v'],
    evidence: { id: 'e1' },
    meta: {},
    messages: [],
  })
  assert.match(prompt, /契约边界：[\s\S]*不改接口/)
  assert.match(prompt, /契约里不做：[\s\S]*不加批量导出/)
  assert.match(prompt, /契约假设：[\s\S]*浏览器支持下载/)
})

test('a long proof entry reaches the verifier whole, not cut into a broken command', () => {
  const entry = `node -e '${'x'.repeat(900)}' && npm test`
  const prompt = verifierPromptOf({
    room,
    stage: room.stages[0],
    stageIndex: 0,
    verifier: 'v',
    targets: ['v'],
    ids: ['v'],
    evidence: { id: 'e1' },
    meta: { proof: { entry, status: 'verified', exit: 0, output: 'ok' } },
    messages: [],
  })
  assert.ok(prompt.includes(entry))
  assert.match(prompt, /以你复核副本里的 lodge-proof\.json 或 lodge-proof\/<n>\.json 为准/)
})
