import assert from 'node:assert/strict'
import test from 'node:test'
import { hostPrompt, speakerPrompt, stripRoundLead, wantsStructuredSummary } from './prompts.js'

const room = {
  goal: '朏朏住哪',
  members: [{ id: 'a', name: '甲', personality: 'assertive', stance: 'proposer', voice: '先问代价。' }],
}

test('a turn carries the last conclusion and the speaker before it', () => {
  const prompt = speakerPrompt({
    room,
    memberId: 'a',
    round: 2,
    turn: 1,
    turnLimit: 6,
    brief: '共识：住上沿；分歧：要不要一直走',
    previous: { name: '老周', text: '上沿没问题，但别一直走。' },
  })
  assert.match(prompt, /上一轮结论：共识：住上沿；分歧：要不要一直走/)
  assert.match(prompt, /上一位：老周说“上沿没问题，但别一直走。”/)
  assert.match(prompt, /50 字以内/)
  assert.match(prompt, /不要为了合群改口/)
  assert.doesNotMatch(prompt, /请给出你的观点、依据或质疑/)
})

test('the first turn does not invent a brief or a previous speaker', () => {
  const prompt = speakerPrompt({ room, memberId: 'a', round: 1, turn: 1, turnLimit: 6 })
  assert.doesNotMatch(prompt, /上一轮结论/)
  assert.doesNotMatch(prompt, /上一位：/)
  assert.doesNotMatch(prompt, /接着说/)
  assert.match(prompt, /这是本轮第一句：直接说自己的判断/)
  assert.match(prompt, /50 字以内/)
  assert.match(prompt, /第 1 轮，第 1\/6 次发言/)
})

test('an ordinary request for a list keeps the structured summary', () => {
  for (const note of ['分条说', '逐条列一下', '列成清单', '用表格', '给我一个清单', 'bullet points']) {
    assert.equal(wantsStructuredSummary(note), true, note)
  }
  for (const note of ['不要列表，简单说', '别用清单', '不用分点', '不要表格']) {
    assert.equal(wantsStructuredSummary(note), false, note)
  }
  assert.equal(wantsStructuredSummary('简单说说'), false)
  assert.equal(wantsStructuredSummary(''), false)
})

test('the host conclusion drops a leading round label', () => {
  assert.equal(stripRoundLead('第 1 轮落在共识上：绵密不靠辞藻。'), '落在共识上：绵密不靠辞藻。')
  assert.equal(stripRoundLead('第十二轮：结论是先做小版本。'), '结论是先做小版本。')
  assert.equal(stripRoundLead('结论是先做小版本。'), '结论是先做小版本。')
})

test('the host prompt tells the model not to write round numbers', () => {
  const prompt = hostPrompt({ room, round: 1, note: '', turnLimit: 6 })
  assert.match(prompt, /不要写“第 N 轮”/)
  assert.doesNotMatch(prompt, /聊天室第 1 轮讨论到此结束/)
})

test('the previous turn and brief are sanitized before they enter a prompt', () => {
  const prompt = speakerPrompt({
    room,
    memberId: 'a',
    round: 2,
    turn: 2,
    turnLimit: 6,
    brief: '共识：先做​小版本',
    previous: { name: '乙​', text: '前一句​后面' },
  })
  assert.doesNotMatch(prompt, /​/)
  assert.match(prompt, /上一轮结论：共识：先做小版本/)
  assert.match(prompt, /上一位：乙说“前一句后面”/)
})

test('a very long previous turn is clipped', () => {
  const prompt = speakerPrompt({
    room,
    memberId: 'a',
    round: 2,
    turn: 2,
    turnLimit: 6,
    previous: { name: '乙', text: '长'.repeat(500) },
  })
  assert.match(prompt, /…/)
  assert.ok(prompt.length < 1_500)
})
