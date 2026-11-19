import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStudioRequest, DEFAULT_STUDIO_MEMBERS } from './create.js'

const base = {
  name: '交付演练',
  repoPath: '',
  verify: 'manual',
  acceptance: '',
  proposal: null,
  answers: [],
  memberChoices: [],
  hasMemberChoice: false,
  members: DEFAULT_STUDIO_MEMBERS,
  selectedModelOf: () => '',
}

test('browser capability and room access are carried separately', () => {
  assert.equal('browser' in buildStudioRequest(base), false)
  const ask = buildStudioRequest({ ...base, browser: true })
  assert.equal(ask.browser, true)
  assert.equal(ask.roomAccess, 'ask')
  assert.equal(buildStudioRequest({ ...base, browser: true, roomAccess: 'allow' }).roomAccess, 'allow')
})

test('a direct studio request needs no plan or member override', () => {
  const request = buildStudioRequest(base)
  assert.equal(request.roomType, 'studio')
  assert.equal(request.verify, 'manual')
  assert.equal(request.acceptance, '')
  assert.equal('plan' in request, false)
  assert.equal('members' in request, false)
})

test('a studio started from chat carries where it came from', () => {
  const request = buildStudioRequest({
    ...base,
    handoff: { topic: '发布检查', consensus: [], disagreements: [], constraints: [], todos: [] },
    sourceRoomId: 'room-chat',
    sourceName: '圆桌',
  })
  assert.equal(request.sourceRoomId, 'room-chat')
  assert.equal(request.sourceName, '圆桌')
  assert.equal(request.handoff.topic, '发布检查')
})

test('command verification carries the acceptance command', () => {
  const request = buildStudioRequest({ ...base, verify: 'test', acceptance: 'npm test' })
  assert.equal(request.verify, 'test')
  assert.equal(request.acceptance, 'npm test')
})

test('model overrides send the default roster', () => {
  const choices = [
    { engine: 'claude-cli', model: '' },
    { engine: 'codex-cli', model: '' },
    { engine: 'claude-cli', model: '' },
  ]
  const request = buildStudioRequest({
    ...base,
    memberChoices: choices,
    hasMemberChoice: true,
    selectedModelOf: choice => `${choice.engine}-default`,
  })
  assert.deepEqual(request.members.map(seat => seat.role), ['lead', 'worker', 'verifier'])
  assert.equal(request.members[0].engine, 'claude-cli')
  assert.equal(request.members[0].model, 'claude-cli-default')
})

test('a proposal still carries its plan and answers', () => {
  const proposal = {
    verify: 'test',
    members: [{ role: 'lead', name: '规划师' }, { role: 'verifier', name: '验收员' }],
    done: ['跑通启动说明'],
    stages: [{ title: '写说明', acceptance: 'npm test' }],
    questions: [{ text: '写给谁？', recommendation: '新同事' }],
  }
  const request = buildStudioRequest({
    ...base,
    proposal,
    answers: ['第一次接触项目的人'],
    acceptance: 'npm test',
  })
  assert.equal(request.verify, 'test')
  assert.deepEqual(request.members.map(seat => seat.role), ['lead', 'verifier'])
  assert.deepEqual(request.plan.done, ['跑通启动说明'])
  assert.deepEqual(request.plan.answers, [
    { question: '写给谁？', answer: '第一次接触项目的人' },
  ])
})

test('shadow review is requested only when enabled', () => {
  assert.equal('shadowReview' in buildStudioRequest(base), false)
  assert.equal(buildStudioRequest({ ...base, shadowReview: true }).shadowReview, true)
})
