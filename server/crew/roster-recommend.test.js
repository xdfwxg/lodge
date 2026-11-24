import assert from 'node:assert/strict'
import test from 'node:test'
import { SCOUT_SOUL, parseProposal, recommendRoster, recommendationPrompt } from './roster-recommend.js'
import { createRosterProbe } from './roster-probe.js'

const reply = body => `这是队长的方案：\n\n\`\`\`json\n${JSON.stringify({ done: ['完成条件'], ...body })}\n\`\`\`\n`

test('the scout names its own job; the turn prompt carries only facts and the shape', () => {
  assert.match(SCOUT_SOUL, /编队建议员/)
  assert.doesNotMatch(SCOUT_SOUL, /你是规划师/)
  assert.match(SCOUT_SOUL, /不写代码、不改文件、不执行工具/)
  const prompt = recommendationPrompt('做一个欢迎语', '/tmp/repo')
  assert.match(prompt, /目标：做一个欢迎语/)
  assert.match(prompt, /"members"/)
  // 身份在主提示里；每轮不再自称，也不再重复边界。
  assert.doesNotMatch(prompt, /你是/)
  assert.doesNotMatch(prompt, /不写代码|不改文件|不建群/)
})

test('raw newlines and trailing commas inside the reply still parse', () => {
  const text = '```json\n{"done": ["第一行\n第二行",],"members": [{"role":"lead","name":"规划师"},{"role":"worker","name":"执行官"},{"role":"verifier","name":"验收员"}],"verify":"test","acceptance":"npm test"}\n```'
  const proposal = parseProposal(text)
  assert.equal(proposal.done[0], '第一行\n第二行')
  assert.deepEqual(proposal.members.map(member => member.role), ['lead', 'worker', 'verifier'])
})

test('the fixed three-member squad keeps role names and reasons in the card', () => {
  const proposal = parseProposal(reply({
    done: ['hello.txt 内容为 crew ok'],
    questions: [{ text: '文件放在根目录吗？', recommendation: '放根目录' }],
    members: [
      { role: 'lead', name: '规划', reason: '对齐目标' },
      { role: 'worker', name: '执行', reason: '实现与跑测试' },
      { role: 'verifier', name: '验收', reason: '独立复核' },
    ],
    verify: 'test',
    acceptance: 'npm test',
    why: '固定三人小队分工',
  }))
  assert.deepEqual(proposal.members.map(member => member.role), ['lead', 'worker', 'verifier'])
  assert.deepEqual(proposal.members.map(member => member.name), ['规划师', '执行官', '验收员'])
  assert.equal(proposal.members[1].reason, '实现与跑测试')
  assert.deepEqual(proposal.done, ['hello.txt 内容为 crew ok'])
  assert.equal(proposal.questions.length, 1)
  assert.equal(proposal.questions[0].recommendation, '放根目录')
  assert.equal(proposal.verify, 'test')
  assert.equal(proposal.acceptance, 'npm test')
})

test('the card carries orchestration and only worker assignees', () => {
  const proposal = parseProposal(reply({
    members: [
      { role: 'lead', name: '规划师' },
      { role: 'worker' },
      { role: 'worker' },
      { role: 'verifier', name: '验收员' },
    ],
    orchestration: 'parallel',
    stages: [{ title: '实现', kind: 'deliverable', acceptance: 'npm test', assignees: ['worker', '验收员', '不存在'] }],
    verify: 'test',
    acceptance: 'npm test',
    why: '两个执行席位可并行',
  }))
  assert.equal(proposal.orchestration, 'parallel')
  assert.deepEqual(proposal.stages[0].assignees, ['worker'])
})

test('an unknown orchestration falls back to pipeline with a visible note', () => {
  const proposal = parseProposal(reply({
    members: [{ role: 'worker', name: '执行者' }],
    orchestration: 'swarm',
    verify: 'manual',
    why: '单人',
  }))
  assert.equal(proposal.orchestration, 'pipeline')
  assert.match(proposal.note, /不认识的分配方式/)
})

test('a team proposal keeps canonical names and reasons and derives permissions later', () => {
  const proposal = parseProposal(reply({
    members: [
      { role: 'lead', name: '统筹', reason: '负责对齐' },
      { role: 'worker', name: '前端', reason: '实现界面' },
      { role: 'worker', name: '后端', reason: '实现接口' },
      { role: 'verifier', name: '复核', reason: '独立验收' },
    ],
    verify: 'test',
    acceptance: 'npm test',
    why: '工作可拆且需要独立验收',
  }))
  assert.deepEqual(proposal.members.map(member => member.name), ['规划师', '执行官', '执行官 2', '验收员'])
  assert.equal(proposal.members[1].reason, '实现界面')
  assert.equal(proposal.members[2].reason, '实现接口')
  assert.deepEqual(proposal.questions, [])
})

test('common role aliases are normalized', () => {
  const proposal = parseProposal(reply({
    members: [
      { role: 'planner', name: '统筹' },
      { role: 'executor', name: '前端' },
      { role: 'reviewer', name: '复核' },
    ],
    verify: 'test',
    acceptance: 'npm test',
  }))
  assert.deepEqual(proposal.members.map(member => member.role), ['lead', 'worker', 'verifier'])
})

test('questions are capped at three and keep their recommendation', () => {
  const proposal = parseProposal(reply({
    questions: [
      { text: 'q1', recommendation: 'a1' },
      { text: 'q2', recommendation: 'a2' },
      { text: 'q3', recommendation: 'a3' },
      { text: 'q4', recommendation: 'a4' },
    ],
    members: [{ role: 'worker', name: '执行' }],
    verify: 'manual',
  }))
  assert.deepEqual(proposal.questions.map(item => item.text), ['q1', 'q2', 'q3'])
  assert.match(proposal.note, /超过 3 个/)
})

test('decision questions keep their options, costs and recommendation', () => {
  const proposal = parseProposal(reply({
    questions: [{
      text: '先修哪一层？',
      options: [
        { label: '只加重试', cost: '快，但不解决根因' },
        { label: '同时改服务端超时', cost: '慢，但更彻底' },
        { label: '先复现', cost: '最稳，但这一轮可能只产出诊断' },
      ],
      recommendation: '同时改服务端超时',
    }],
    members: [{ role: 'worker', name: '执行' }],
    verify: 'manual',
  }))
  assert.equal(proposal.questions[0].text, '先修哪一层？')
  assert.deepEqual(proposal.questions[0].options.map(option => option.label), [
    '只加重试',
    '同时改服务端超时',
    '先复现',
  ])
  assert.equal(proposal.questions[0].options[0].cost, '快，但不解决根因')
  assert.equal(proposal.questions[0].recommendation, '同时改服务端超时')
})

test('a test proposal without a command falls back to human confirmation', () => {
  const proposal = parseProposal(reply({
    members: [{ role: 'worker', name: '执行' }],
    verify: 'test',
    acceptance: '',
    why: '文档任务',
  }))
  assert.equal(proposal.verify, 'manual')
  assert.equal(proposal.acceptance, '')
  assert.match(proposal.note, /你确认/)
})

test('an unparsable reply fails closed', () => {
  assert.throws(() => parseProposal('我觉得需要三个人。'), /没有给出可用的方案/)
})

test('too many done items are trimmed visibly', () => {
  const proposal = parseProposal(reply({
    done: Array.from({ length: 7 }, (_, index) => `条件 ${index + 1}`),
    members: [{ role: 'worker', name: '执行' }],
    verify: 'test',
    acceptance: 'npm test',
  }))
  assert.equal(proposal.done.length, 6)
  assert.match(proposal.note, /超过 6 条/)
})

test('a proposal without done fails closed', () => {
  assert.throws(() => parseProposal(reply({
    done: [],
    members: [{ role: 'worker', name: '执行' }],
    verify: 'manual',
  })), /可核对的结果/)
})

test('a manual proposal with a verifier fails closed', () => {
  assert.throws(() => parseProposal(reply({
    members: [
      { role: 'worker', name: '执行' },
      { role: 'verifier', name: '复核' },
    ],
    verify: 'manual',
  })), /一条能跑的检查/)
})

test('a second verifier is rejected by the member contract', () => {
  assert.throws(() => parseProposal(reply({
    members: [
      { role: 'worker', name: '执行' },
      { role: 'verifier', name: '复核 A' },
      { role: 'verifier', name: '复核 B' },
      { role: 'verifier', name: '复核 C' },
      { role: 'verifier', name: '复核 D' },
    ],
    verify: 'test',
    acceptance: 'npm test',
  })), /at most three verifiers/)
})

test('an unknown role fails closed', () => {
  assert.throws(() => parseProposal(reply({
    members: [{ role: 'observer', name: '观察' }],
    verify: 'manual',
  })), /角色不合法/)
})

test('a proposal without a worker fails closed', () => {
  assert.throws(() => parseProposal(reply({
    members: [{ role: 'lead', name: '队长' }],
    verify: 'manual',
  })), /worker/)
})

test('a proposal can carry up to three planned stages', () => {
  const proposal = parseProposal(reply({
    members: [{ role: 'worker', name: '执行' }, { role: 'verifier', name: '复核' }],
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
    members: [
      { role: 'lead', name: '规划师', reason: '对齐目标' },
      { role: 'worker', name: '执行者', reason: '实现与跑测试' },
      { role: 'verifier', name: '验收员', reason: '独立复核' },
    ],
    verify: 'test',
    acceptance: 'npm test',
    why: '固定三人小队分工',
  })
  let sentPrompt = ''
  const engine = {
    capabilities: () => ({ provisioning: true, mentions: true }),
    health: async () => ({ ok: true }),
    createMemberBot: async () => ({ id: 'bot-1' }),
    createRoom: async () => ({ id: 'probe-1', sessionRef: 'thread-1' }),
    sendTurn: async ({ text }) => {
      sentPrompt = text
      return { accepted: true }
    },
    history: async () => ({ messages: [{ kind: 'turn', turn: { reply: proposalReply } }] }),
    cancelTurn: async () => {},
    deleteRoom: async () => {},
    deleteMemberBot: async () => {},
  }
  const provider = {
    prepareRoom: ({ source, members }) => ({ members: { [members[0].id]: { path: source } } }),
    cleanupRoom: () => { cleaned += 1 },
  }
  const workspace = {
    root: () => '/tmp/crew-roster-test',
    default: provider,
    remove: source => removed.push(source),
  }
  const result = await recommendRoster({
    probe: createRosterProbe({ engine }),
    body: {
      goal: '小改动',
      repoPath: '',
      handoffBrief: {
        topic: '发布检查',
        consensus: ['先做最小版本'],
        disagreements: [],
        constraints: [],
        todos: ['写清单'],
      },
    },
    workspace,
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.body.proposal.members.length, 3)
  assert.match(sentPrompt, /已经确认的交接简报/)
  assert.match(sentPrompt, /先做最小版本/)
  assert.match(sentPrompt, /不要再生成对齐\/确认阶段/)
  assert.equal(cleaned, 1)
  assert.equal(removed.length, 1)
})
