import assert from 'node:assert/strict'
import test from 'node:test'
import { INTERNAL_PROMPT_MARKER, isInternalPrompt } from './internal-prompts.js'
import { studioWorkerPrompt } from './rooms/studio/prompts.js'

test('the studio worker handoff is marked internal', () => {
  const prompt = studioWorkerPrompt({
    room: {
      id: 'room-test',
      goal: '修复两个函数',
      plan: { done: [] },
      stages: [],
      constraints: [],
      leadSeat: 'lead',
      members: ['lead', 'worker'],
      seatNames: { lead: '规划师', worker: '执行者' },
      gate: { advice: [] },
      repoPath: '/tmp/room',
    },
    messages: [],
    stage: { title: '实现', acceptance: 'npm test' },
    index: 0,
    assignee: 'worker',
    acceptance: '验收命令：npm test',
    readOnly: false,
    seatSkills: [],
    workspace: { multi: false, candidate: false },
  })
  assert.equal(prompt.includes(INTERNAL_PROMPT_MARKER), true)
  assert.equal(isInternalPrompt(prompt), true)
})
