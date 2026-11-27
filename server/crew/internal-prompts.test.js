import assert from 'node:assert/strict'
import test from 'node:test'
import { INTERNAL_PROMPT_MARKER, isInternalPrompt } from './internal-prompts.js'
import { studioWorkerPrompt } from './rooms/studio/runtime/prompts.js'

test('the studio worker handoff is marked internal', () => {
  const prompt = studioWorkerPrompt({
    room: {
      id: 'room-test',
      goal: '修复两个函数',
      plan: { done: [] },
      stages: [],
      constraints: [],
      leadMemberId: 'lead',
      members: [
        { id: 'lead', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base' } },
        { id: 'worker', name: '执行者', role: 'worker', roleKind: 'executor', body: { kind: 'base' } },
      ],
      gate: { advice: [] },
      repoPath: '/tmp/room',
    },
    messages: [],
    stage: { title: '实现' },
    index: 0,
    assignee: 'worker',
    readOnly: false,
    seatSkills: [],
    workspace: { candidate: false },
  })
  assert.equal(prompt.includes(INTERNAL_PROMPT_MARKER), true)
  assert.equal(isInternalPrompt(prompt), true)
  // 同伴只写名字，不写 @；群里那条 @ 由系统投影。
  assert.match(prompt, /最后一句写清交给谁（写名字，不带 @）/)
  assert.doesNotMatch(prompt, /交接那句 @ 按你的角色规则/)
})

test('the executor sees the same contract the verifier judges against', () => {
  const prompt = studioWorkerPrompt({
    room: {
      id: 'room-test',
      goal: '做导出',
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
      stages: [],
      constraints: [],
      members: [],
      repoPath: '/tmp/room',
    },
    messages: [],
    stage: { title: '实现', clauseIds: ['export'] },
    index: 0,
    workspace: {},
  })
  assert.match(prompt, /\[export\] 导出按钮能用/)
  assert.match(prompt, /边界：不改接口/)
  assert.match(prompt, /不做：不加批量导出/)
  assert.match(prompt, /前提假设：浏览器支持下载/)
})
