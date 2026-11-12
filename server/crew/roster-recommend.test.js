import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProposal, recommendRoster } from './roster-recommend.js'

const reply = body => `这是队长的方案：\n\n\`\`\`json\n${JSON.stringify({ done: ['完成条件'], ...body })}\n\`\`\`\n`

test('the fixed three-seat squad keeps names and reasons in the card', () => {
  const proposal = parseProposal(reply({
    done: ['hello.txt 内容为 crew ok'],
    questions: [{ text: '文件放在根目录吗？', recommendation: '放根目录' }],
    seats: [
      { role: 'lead', name: '规划师', reason: '对齐目标' },
      { role: 'worker', name: '执行者', reason: '实现与跑测试' },
      { role: 'verifier', name: '验收员', reason: '独立复核' },
    ],
    verify: 'test',
    acceptance: 'npm test',
    why: '固定三人小队分工',
  }))
  assert.deepEqual(proposal.seats.map(seat => seat.role), ['lead', 'worker', 'verifier'])
  assert.deepEqual(proposal.done, ['hello.txt 内容为 crew ok'])
  assert.equal(proposal.questions.length, 1)
  assert.equal(proposal.questions[0].recommendation, '放根目录')
  assert.equal(proposal.verify, 'test')
  assert.equal(proposal.acceptance, 'npm test')
})

test('the card carries orchestration and only worker assignees', () => {
  const proposal = parseProposal(reply({
    seats: [
      { role: 'lead', name: '规划师' },
      { role: 'worker', name: '甲' },
      { role: 'worker', name: '乙' },
      { role: 'verifier', name: '验收员' },
    ],
    orchestration: 'parallel',
    stages: [{ title: '实现', kind: 'deliverable', acceptance: 'npm test', assignees: ['甲', '验收员', '不存在'] }],
    verify: 'test',
    acceptance: 'npm test',
    why: '两个执行席位可并行',
  }))
  assert.equal(proposal.orchestration, 'parallel')
  assert.deepEqual(proposal.stages[0].assignees, ['worker'])
})

test('an unknown orchestration falls back to pipeline with a visible note', () => {
  const proposal = parseProposal(reply({
    seats: [{ role: 'worker', name: '执行者' }],
    orchestration: 'swarm',
    verify: 'manual',
    why: '单人',
  }))
  assert.equal(proposal.orchestration, 'pipeline')
  assert.match(proposal.note, /未知编排策略/)
})

test('a team proposal keeps names and reasons and derives permissions later', () => {
  const proposal = parseProposal(reply({
    seats: [
      { role: 'lead', name: '统筹', reason: '负责对齐' },
      { role: 'worker', name: '前端', reason: '实现界面' },
      { role: 'worker', name: '后端', reason: '实现接口' },
      { role: 'verifier', name: '复核', reason: '独立验收' },
    ],
    verify: 'test',
    acceptance: 'npm test',
    why: '工作可拆且需要独立验收',
  }))
  assert.deepEqual(proposal.seats.map(seat => seat.name), ['统筹', '前端', '后端', '复核'])
  assert.equal(proposal.seats[1].reason, '实现界面')
  assert.deepEqual(proposal.questions, [])
})

test('common role aliases are normalized', () => {
  const proposal = parseProposal(reply({
    seats: [
      { role: 'planner', name: '统筹' },
      { role: 'executor', name: '前端' },
      { role: 'reviewer', name: '复核' },
    ],
    verify: 'test',
    acceptance: 'npm test',
  }))
  assert.deepEqual(proposal.seats.map(seat => seat.role), ['lead', 'worker', 'verifier'])
})

test('questions are capped at three and keep their recommendation', () => {
  const proposal = parseProposal(reply({
    questions: [
      { text: 'q1', recommendation: 'a1' },
      { text: 'q2', recommendation: 'a2' },
      { text: 'q3', recommendation: 'a3' },
      { text: 'q4', recommendation: 'a4' },
    ],
    seats: [{ role: 'worker', name: '执行' }],
    verify: 'manual',
  }))
  assert.deepEqual(proposal.questions.map(item => item.text), ['q1', 'q2', 'q3'])
  assert.match(proposal.note, /超过 3 个/)
})

test('a test proposal without a command falls back to human confirmation', () => {
  const proposal = parseProposal(reply({
    seats: [{ role: 'worker', name: '执行' }],
    verify: 'test',
    acceptance: '',
    why: '文档任务',
  }))
  assert.equal(proposal.verify, 'manual')
  assert.equal(proposal.acceptance, '')
  assert.match(proposal.note, /你确认/)
})

test('an unparsable reply fails closed', () => {
  assert.throws(() => parseProposal('我觉得需要三个人。'), /可解析/)
})

test('too many done items are trimmed visibly', () => {
  const proposal = parseProposal(reply({
    done: Array.from({ length: 7 }, (_, index) => `条件 ${index + 1}`),
    seats: [{ role: 'worker', name: '执行' }],
    verify: 'test',
    acceptance: 'npm test',
  }))
  assert.equal(proposal.done.length, 6)
  assert.match(proposal.note, /超过 6 条/)
})

test('a proposal without done fails closed', () => {
  assert.throws(() => parseProposal(reply({
    done: [],
    seats: [{ role: 'worker', name: '执行' }],
    verify: 'manual',
  })), /done/)
})

test('a manual proposal with a verifier fails closed', () => {
  assert.throws(() => parseProposal(reply({
    seats: [
      { role: 'worker', name: '执行' },
      { role: 'verifier', name: '复核' },
    ],
    verify: 'manual',
  })), /验收命令/)
})

test('two verifiers are accepted and kept in the proposal', () => {
  const proposal = parseProposal(reply({
    seats: [
      { role: 'worker', name: '执行' },
      { role: 'verifier', name: '复核 A' },
      { role: 'verifier', name: '复核 B' },
    ],
    verify: 'test',
    acceptance: 'npm test',
  }))
  assert.equal(proposal.seats.filter(seat => seat.role === 'verifier').length, 2)
})

test('an unknown role fails closed', () => {
  assert.throws(() => parseProposal(reply({
    seats: [{ role: 'observer', name: '观察' }],
    verify: 'manual',
  })), /角色不合法/)
})

test('a proposal without a worker fails closed', () => {
  assert.throws(() => parseProposal(reply({
    seats: [{ role: 'lead', name: '队长' }],
    verify: 'manual',
  })), /worker/)
})

test('a proposal can carry up to three planned stages', () => {
  const proposal = parseProposal(reply({
    seats: [{ role: 'worker', name: '执行' }, { role: 'verifier', name: '复核' }],
    verify: 'test',
    acceptance: 'npm test',
    stages: [
      { title: '实现', kind: 'deliverable', acceptance: 'npm test' },
      { title: '回归', kind: 'deliverable', acceptance: 'npm run e2e' },
    ],
  }))
  assert.deepEqual(proposal.stages.map(stage => stage.title), ['实现', '回归'])
  assert.equal(proposal.stages[1].acceptance, 'npm run e2e')
})

test('recommendRoster uses the injected workspace port for its temporary room', async () => {
  const removed = []
  let cleaned = 0
  const proposalReply = reply({
    seats: [
      { role: 'lead', name: '规划师', reason: '对齐目标' },
      { role: 'worker', name: '执行者', reason: '实现与跑测试' },
      { role: 'verifier', name: '验收员', reason: '独立复核' },
    ],
    verify: 'test',
    acceptance: 'npm test',
    why: '固定三人小队分工',
  })
  const engine = {
    capabilities: () => ({ provisioning: true }),
    health: async () => ({ ok: true }),
    createSeatBot: async () => ({ id: 'bot-1' }),
    createRoom: async () => ({ id: 'probe-1', sessionRef: 'thread-1' }),
    sendTurn: async () => ({ accepted: true }),
    history: async () => ({ messages: [{ kind: 'turn', turn: { reply: proposalReply } }] }),
    cancelTurn: async () => {},
    deleteRoom: async () => {},
    deleteSeatBot: async () => {},
  }
  const provider = {
    prepareRoom: ({ source, seats }) => ({ seats: { [seats[0].id]: { path: source } } }),
    cleanupRoom: () => { cleaned += 1 },
  }
  const workspace = {
    root: () => '/tmp/crew-roster-test',
    default: provider,
    remove: source => removed.push(source),
  }
  const result = await recommendRoster({ engine, body: { goal: '小改动', repoPath: '' }, workspace })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.body.proposal.seats.length, 3)
  assert.equal(cleaned, 1)
  assert.equal(removed.length, 1)
})
