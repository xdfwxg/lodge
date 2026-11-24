import assert from 'node:assert/strict'
import test from 'node:test'
import { emailOf, emailWorthSending } from './email.js'

test('the email carries the produced text and its files', () => {
  const email = emailOf({
    room: { name: '周报', goal: '每周把销售算好' },
    promise: { text: '每周把销售算好并发我邮箱', delivery: { channel: 'email', to: 'me@example.com' } },
    roundId: 'round-1',
    messages: [
      { kind: 'conclusion', text: '已交付：每周把销售算好', meta: { roundId: 'round-1' } },
      { kind: 'chat', text: 'ignored', meta: { artifacts: [{ path: '/tmp/report.md' }] } },
    ],
    readArtifact: path => path.endsWith('report.md') ? '# 本周销售\n\n100 单' : '',
  })
  assert.equal(email.to, 'me@example.com')
  assert.match(email.subject, /周报/)
  assert.match(email.text, /本周销售/)
  assert.match(email.text, /\/tmp\/report\.md/)
  assert.equal(email.roundId, 'round-1')
})

test('a conclusion stands in when there is no text artifact', () => {
  const email = emailOf({
    room: { name: '周报' },
    promise: { text: '把结论发我', delivery: { channel: 'email', to: 'me@example.com' } },
    messages: [{ kind: 'conclusion', text: '这周没有新变化', meta: { roundId: 'round-1' } }],
  })
  assert.match(email.text, /这周没有新变化/)
})

test('changes-only email waits for a changed issue', () => {
  assert.equal(emailWorthSending({ delivery: { channel: 'email', mode: 'always' }, lastChange: 'no' }), true)
  assert.equal(emailWorthSending({ delivery: { channel: 'email', mode: 'changes' }, lastChange: 'no' }), false)
  assert.equal(emailWorthSending({ delivery: { channel: 'email', mode: 'changes' }, lastChange: 'yes' }), true)
  assert.equal(emailWorthSending({ delivery: { channel: 'room', mode: 'always' }, lastChange: 'no' }), false)
})
