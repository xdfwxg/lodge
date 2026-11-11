import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProposal } from './roster-recommend.js'

const reply = body => `这是队长的方案：\n\n\`\`\`json\n${JSON.stringify({ done: ['完成条件'], ...body })}\n\`\`\`\n`

test('a small goal can be a one-seat room with one card', () => {
  const proposal = parseProposal(reply({
    done: ['hello.txt 内容为 crew ok'],
    questions: [{ text: '文件放在根目录吗？', recommendation: '放根目录' }],
    seats: [{ role: 'worker', name: '执行', reason: '一个人能完成' }],
    verify: 'test',
    acceptance: 'npm test',
    why: '小改动，单人交付',
  }))
  assert.equal(proposal.seats.length, 1)
  assert.equal(proposal.seats[0].role, 'worker')
  assert.deepEqual(proposal.done, ['hello.txt 内容为 crew ok'])
  assert.equal(proposal.questions.length, 1)
  assert.equal(proposal.questions[0].recommendation, '放根目录')
  assert.equal(proposal.verify, 'test')
  assert.equal(proposal.acceptance, 'npm test')
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

test('two verifiers fail closed', () => {
  assert.throws(() => parseProposal(reply({
    seats: [
      { role: 'worker', name: '执行' },
      { role: 'verifier', name: '复核 A' },
      { role: 'verifier', name: '复核 B' },
    ],
    verify: 'manual',
  })), /一个验收/)
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
