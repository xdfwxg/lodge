import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStudioRequest, DEFAULT_STUDIO_MEMBERS } from './create.js'

const base = {
  name: '交付演练',
  repoPath: '',
  verify: 'manual',
    proposal: null,
  answers: [],
  memberChoices: [],
  hasMemberChoice: false,
  members: DEFAULT_STUDIO_MEMBERS,
  selectedModelOf: () => '',
}

test('browser access is system-wide, not a room request field', () => {
  const request = buildStudioRequest({ ...base, browser: true, roomAccess: 'allow' })
  assert.equal('browser' in request, false)
  assert.equal('roomAccess' in request, false)
})

test('a studio request only carries the goal, the folder and the handoff brief', () => {
  const request = buildStudioRequest(base)
  assert.equal(request.roomType, 'studio')
  assert.equal('verify' in request, false)
  assert.equal('acceptance' in request, false)
  assert.equal('plan' in request, false)
  assert.equal('members' in request, false)
})

test('a studio started from chat carries where it came from', () => {
  const request = buildStudioRequest({
    ...base,
    handoffBrief: { topic: '发布检查', consensus: [], disagreements: [], constraints: [], todos: [] },
    sourceRoomId: 'room-chat',
    sourceName: '圆桌',
  })
  assert.equal(request.sourceRoomId, 'room-chat')
  assert.equal(request.sourceName, '圆桌')
  assert.equal(request.handoffBrief.topic, '发布检查')
})

test('member and model choices are no longer sent', () => {
  const request = buildStudioRequest({
    ...base,
    memberChoices: [{ engine: 'claude-cli', model: '' }, { engine: 'codex-cli', model: '' }, { engine: 'claude-cli', model: '' }],
    hasMemberChoice: true,
    selectedModelOf: choice => `${choice.engine}-default`,
    proposal: {
      verify: 'test',
      members: [{ role: 'lead', name: '规划师' }, { role: 'verifier', name: '验收员' }],
      done: ['跑通启动说明'],
      stages: [{ title: '写说明' }],
      questions: [],
    },
  })
  assert.equal('members' in request, false)
  assert.equal('plan' in request, false)
  assert.equal('verify' in request, false)
})

test('shadow review and auto delivery are no longer creation requests', () => {
  assert.equal('shadowReview' in buildStudioRequest({ ...base, shadowReview: true }), false)
  assert.equal('autoDeliver' in buildStudioRequest({ ...base, autoDeliver: true }), false)
})
