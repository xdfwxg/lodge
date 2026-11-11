import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewExternalAction } from './gate.js'

const room = (over = {}) => ({
  seatSpecs: [
    { id: 'worker', role: 'worker' },
    { id: 'verifier', role: 'verifier' },
    { id: 'lead', role: 'lead' },
  ],
  constraints: [],
  ...over,
})

const approval = (seat, summary, kind = 'network') => ({
  seat,
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

test('lead and verifier seats are not allowed to create external writes', () => {
  const verifier = reviewExternalAction({ approval: approval('verifier', 'curl https://example.com'), room: room() })
  assert.equal(verifier.decision, 'deny')
  assert.match(verifier.reasons.join('，'), /验收席位/)
  const lead = reviewExternalAction({ approval: approval('lead', 'npm install left-pad', 'install'), room: room() })
  assert.equal(lead.decision, 'deny')
})

test('room constraints can block push, network or install', () => {
  const push = reviewExternalAction({
    approval: approval('worker', 'git push origin main', 'push'),
    room: room({ constraints: ['不 push，不发布'] }),
  })
  assert.equal(push.decision, 'deny')
  assert.match(push.reasons.join('，'), /约束禁止 push/)
  const network = reviewExternalAction({
    approval: approval('worker', 'curl https://example.com'),
    room: room({ projectConstraints: { content: '不要联网' } }),
  })
  assert.equal(network.decision, 'deny')
})

test('the gate declares an independent basis', () => {
  const result = reviewExternalAction({ approval: approval('worker', 'curl https://example.com'), room: room() })
  assert.equal(result.context, 'independent')
  assert.match(result.basis, /不读执行席位对话/)
})
