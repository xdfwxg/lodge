import assert from 'node:assert/strict'
import test from 'node:test'
import { INTERNAL_PROMPT_MARKER, isInternalPrompt } from './internal-prompts.js'
import { studioPlannerPrompt } from './live-studio.js'

test('the studio planner prompt is marked internal', () => {
  const prompt = studioPlannerPrompt({
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
  })
  assert.equal(prompt.includes(INTERNAL_PROMPT_MARKER), true)
  assert.equal(isInternalPrompt(prompt), true)
})
