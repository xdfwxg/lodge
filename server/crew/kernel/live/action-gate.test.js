import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewExternalAction } from './action-gate.js'

const room = (over = {}) => ({
  members: [
    { id: 'worker', role: 'worker', roleKind: 'executor' },
    { id: 'verifier', role: 'verifier', roleKind: 'verifier' },
    { id: 'lead', role: 'lead', roleKind: 'planner' },
  ],
  constraints: [],
  ...over,
})

const approval = (memberId, summary, kind = 'network') => ({
  memberId,
  summary,
  kind,
  label: '访问网络',
})

test('a push or install gets a review recommendation, not an automatic pass', () => {
  const push = reviewExternalAction({ approval: approval('worker', 'git push origin main', 'push'), room: room() })
  assert.equal(push.decision, 'review')
  assert.equal(push.risk, 'medium')
  assert.match(push.reasons.join('，'), /推送/)
  const install = reviewExternalAction({ approval: approval('worker', 'npm install left-pad', 'install'), room: room() })
  assert.equal(install.decision, 'review')
})

test('privilege and destructive commands are recommended for denial', () => {
  const sudo = reviewExternalAction({ approval: approval('worker', 'sudo rm -rf /tmp/x', 'privilege'), room: room() })
  assert.equal(sudo.decision, 'deny')
  assert.equal(sudo.risk, 'high')
  const clean = reviewExternalAction({ approval: approval('worker', 'git clean -fdx', 'delete'), room: room() })
  assert.equal(clean.decision, 'deny')
})

test('lead and verifier members are not allowed to create external writes', () => {
  const verifier = reviewExternalAction({ approval: approval('verifier', 'curl https://example.com'), room: room() })
  assert.equal(verifier.decision, 'deny')
  assert.match(verifier.reasons.join('，'), /验收员/)
  const lead = reviewExternalAction({ approval: approval('lead', 'npm install left-pad', 'install'), room: room() })
  assert.equal(lead.decision, 'deny')
})

test('the gate declares an independent basis', () => {
  const result = reviewExternalAction({ approval: approval('worker', 'curl https://example.com'), room: room() })
  assert.equal(result.context, 'independent')
  assert.match(result.basis, /不读执行官对话/)
})
