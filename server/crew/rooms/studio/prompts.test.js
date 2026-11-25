import assert from 'node:assert/strict'
import test from 'node:test'
import { studioWorkerPrompt } from './prompts.js'

const room = {
  id: 'room-1',
  goal: '把导出做出来',
  plan: {
    contract: {
      outcomes: [
        { id: 'export', statement: '导出按钮能用', observable: '点导出会下载 CSV' },
        { id: 'docs', statement: '有一页说明', observable: 'README 能照着做' },
      ],
      boundaries: ['只改导出'],
      nonGoals: ['不做移动端'],
      assumptions: [],
    },
  },
  stages: [{
    title: '实现',
    deliverable: '导出按钮能用',
    clauseIds: ['export'],
    packages: [{ title: '导出', files: ['src/export.js'], clauseIds: ['export'] }],
  }],
  members: [{ id: 'executor', name: '执行官', role: 'worker' }],
  worktrees: { executor: '/tmp/worktree' },
}

test('a worker is told which clauses its package proves and must write a step for each', () => {
  const prompt = studioWorkerPrompt({
    room,
    messages: [],
    memberId: 'executor',
    stage: room.stages[0],
    workPackage: room.stages[0].packages[0],
    proofFile: 'lodge-proof.json',
    index: 0,
    workspace: {},
  })
  assert.match(prompt, /你这个包负责的契约要求：\[export\]/)
  assert.match(prompt, /证明里必须为每条要求写一条 step/)
  assert.match(prompt, /"steps":\[\{"clause":"契约 id","run":"能跑的检查"/)
  assert.match(prompt, /clauseIds：export/)
})

test('a stage without package clauses keeps the entry-only prompt', () => {
  const prompt = studioWorkerPrompt({
    room,
    messages: [],
    memberId: 'executor',
    stage: { title: '实现', deliverable: '写完' },
    workPackage: { title: '实现', files: ['src/a.js'] },
    proofFile: 'lodge-proof.json',
    index: 0,
    workspace: {},
  })
  assert.doesNotMatch(prompt, /你这个包负责的契约要求/)
  assert.match(prompt, /"entry":"能重跑的验证命令"/)
})
