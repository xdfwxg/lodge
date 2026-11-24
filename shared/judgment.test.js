import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractJudgmentJson, gateResultOf, judgmentAnchorOf, judgmentFromGate, judgmentOf, normalizeJudgment, plannerDecisionOf, validateJudgment, verdictPassed,
} from './judgment.js'

const verdict = (text, extra = {}) => normalizeJudgment({ type: 'verdict', text, stage: 1, evidenceId: 'e1', actorId: 'v1', ...extra })

test('the first line still decides pass or reject', () => {
  assert.equal(verdict('PASS\n看起来没问题').decision, 'pass')
  assert.equal(verdict('**REJECT**\n还缺 beta').decision, 'reject')
  assert.equal(verdict('结论：不通过').decision, 'reject')
  assert.equal(verdict('判定不清').decision, 'reject')
})

test('the json block carries reason, findings and limits', () => {
  const out = verdict([
    'REJECT',
    '```json',
    JSON.stringify({
      reason: '缺 beta',
      findings: [
        { title: 'shared.txt 只有 alpha', severity: 'blocker', evidence: 'cat shared.txt' },
        { title: '没有合并记录', severity: 'weird', evidence: 'git log' },
      ],
    }),
    '```',
  ].join('\n'))
  assert.equal(out.source, 'json')
  assert.equal(out.reason, '缺 beta')
  assert.deepEqual(out.findings, [
    { title: 'shared.txt 只有 alpha', severity: 'blocker', evidence: 'cat shared.txt' },
    { title: '没有合并记录', severity: 'minor', evidence: 'git log' },
  ])
})

test('a missing or malformed json block falls back to the text', () => {
  const out = verdict('PASS 这一版可以\n命令和测试都过了')
  assert.equal(out.decision, 'pass')
  assert.equal(out.source, 'text')
  assert.equal(out.reason, '这一版可以\n命令和测试都过了')
  assert.deepEqual(out.findings, [])

  const broken = verdict('REJECT\n```json\n{not json}\n```')
  assert.equal(broken.source, 'text')
  assert.equal(broken.reason, '')
  assert.equal(broken.decision, 'reject')
})

test('an inline json fence on the first line is parsed too', () => {
  const out = verdict('PASS 可以 ```json {"reason":"ok","findings":[]} ```')
  assert.equal(out.source, 'json')
  assert.equal(out.reason, 'ok')
  assert.equal(out.decision, 'pass')
})

test('the first valid json block wins', () => {
  const out = verdict([
    'PASS',
    '```json',
    '{"reason":"示例"}',
    '```',
    '```json',
    '{"reason":"真正结论"}',
    '```',
  ].join('\n'))
  assert.equal(out.reason, '示例')
  assert.deepEqual(extractJudgmentJson('no block'), null)
})

test('findings are clipped and invalid entries dropped', () => {
  const out = verdict(`PASS\n\`\`\`json\n${JSON.stringify({
    reason: 'r',
    findings: [
      { title: '', severity: 'blocker' },
      { title: 'a'.repeat(300), severity: 'major', evidence: 'e' },
      7,
    ],
  })}\n\`\`\``)
  assert.equal(out.findings.length, 1)
  assert.equal(out.findings[0].title.length, 200)
  assert.equal(out.findings[0].severity, 'major')
})

test('a gate REJECT must point at a check that would fail', () => {
  const gate = input => judgmentFromGate({ type: 'verdict', input, stage: 1, actorId: 'v1' })
  const reject = findings => gate({ decision: 'REJECT', reason: '还不行', findings })
  assert.equal(reject([{ title: '命名可以更好', severity: 'minor' }]), null)
  assert.equal(reject([{ title: '缺日志', severity: 'major' }]), null)
  const checked = reject([
    { title: '缺日志', severity: 'major', check: 'npm test 会因为没有日志失败' },
    { title: '命名可以更好', severity: 'blocker' },
  ])
  assert.equal(checked.decision, 'reject')
  assert.deepEqual(checked.findings, [
    { title: '缺日志', severity: 'major', evidence: '', check: 'npm test 会因为没有日志失败' },
    { title: '命名可以更好', severity: 'minor', evidence: '' },
  ])
})

test('planner decisions keep the note and require an action for human', () => {
  const rework = normalizeJudgment({
    type: 'planner',
    text: '返工\n```json\n{"reason":"把 shared.txt 改成 done"}\n```',
    stage: 1,
    actorId: 'lead',
  })
  assert.equal(rework.decision, 'rework')
  assert.equal(rework.reason, '把 shared.txt 改成 done')
  assert.equal(rework.actionRequired, '')

  const human = normalizeJudgment({
    type: 'planner',
    text: '交给人\n这一步两种收口都行，你定',
    stage: 1,
  })
  assert.equal(human.decision, 'human')
  assert.equal(human.actionRequired, '这一步两种收口都行，你定')
})

test('validation rejects unknown versions and decisions', () => {
  const good = verdict('PASS\n```json\n{"reason":"ok"}\n```')
  assert.ok(validateJudgment(good))
  assert.equal(validateJudgment({ ...good, version: 2 }), null)
  assert.equal(validateJudgment({ ...good, decision: 'maybe' }), null)
  assert.equal(validateJudgment({ ...good, type: 'other' }), null)
})

test('a verdict without a contract is not invented', () => {
  const legacy = { kind: 'verdict', authorId: 'v1', text: 'PASS 可以', ts: 9, meta: { pass: true, reason: '可以', stage: 0, evidenceId: 'e0' } }
  assert.equal(verdictPassed(legacy), true)
  assert.equal(judgmentOf(legacy), null)
  assert.equal(judgmentOf({ kind: 'chat' }), null)
})

test('the gate view maps a verdict reject to fail and routes it', () => {
  const reject = gateResultOf(verdict('REJECT\n缺 beta'))
  assert.equal(reject.decision, 'fail')
  assert.equal(reject.rejectTo, 'planner')
  const pass = gateResultOf(verdict('PASS\n可以'))
  assert.equal(pass.decision, 'pass')
  assert.equal(pass.rejectTo, null)
  const rework = gateResultOf(normalizeJudgment({ type: 'planner', text: '返工\n再试一次', stage: 0 }))
  assert.equal(rework.decision, 'rework')
  assert.equal(rework.rejectTo, 'worker')
  const human = gateResultOf(normalizeJudgment({ type: 'planner', text: '交给人\n你定', stage: 0 }))
  assert.equal(human.decision, 'human')
  assert.equal(human.rejectTo, 'human')
})

test('only an explicit first-line anchor counts as a submitted judgment', () => {
  assert.equal(judgmentAnchorOf('verdict', 'PASS\nok'), 'pass')
  assert.equal(judgmentAnchorOf('verdict', '**REJECT**\nmissing'), 'reject')
  assert.equal(judgmentAnchorOf('verdict', '我看了一下改动，似乎没问题'), null)
  assert.equal(judgmentAnchorOf('verdict', ''), null)
  assert.equal(judgmentAnchorOf('planner', '返工\n重写'), 'rework')
  assert.equal(judgmentAnchorOf('planner', '交给人\n请你定'), 'human')
  assert.equal(judgmentAnchorOf('planner', '@you 验收员判了没过，需要你拍板'), null)
})

test('the missing source survives validation', () => {
  const missing = validateJudgment({
    version: 1,
    type: 'planner',
    decision: 'human',
    reason: '规划师没有提交决定',
    rejectTo: 'human',
    source: 'missing',
  })
  assert.equal(missing.source, 'missing')
})

test('a room planner decision reads its stored contract', () => {
  const judgment = normalizeJudgment({ type: 'planner', text: '返工\n再试一次', stage: 0 })
  assert.equal(plannerDecisionOf({ lastPlannerDecision: { judgment } }).decision, 'rework')
  assert.equal(plannerDecisionOf({}), null)
})
