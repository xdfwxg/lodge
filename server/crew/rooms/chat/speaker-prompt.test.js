import assert from 'node:assert/strict'
import test from 'node:test'
import { speakerPrompt, wantsStructuredSummary } from './prompts.js'

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
  assert.match(prompt, /接着上面说：同意就补一个理由/)
  assert.doesNotMatch(prompt, /请给出你的观点、依据或质疑/)
})

test('the first turn does not invent a brief or a previous speaker', () => {
  const prompt = speakerPrompt({ room, memberId: 'a', round: 1, turn: 1, turnLimit: 6 })
  assert.doesNotMatch(prompt, /上一轮结论/)
  assert.doesNotMatch(prompt, /上一位/)
  assert.match(prompt, /第 1 轮，第 1\/6 次发言/)
})

test('an ordinary request for a list keeps the structured summary', () => {
  for (const note of ['分条说', '逐条列一下', '列成清单', '用表格', '给我一个清单', 'bullet points']) {
    assert.equal(wantsStructuredSummary(note), true, note)
  }
  assert.equal(wantsStructuredSummary('简单说说'), false)
  assert.equal(wantsStructuredSummary(''), false)
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
