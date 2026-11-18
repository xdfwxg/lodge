import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderStudioMessage } from './message-view.js'

const render = message => renderToStaticMarkup(renderStudioMessage({
  room: { id: 'room-1', messages: [] },
  byId: { v1: { id: 'v1', name: '验收员', roleKind: 'verifier' } },
  message,
  timeline: {},
  onAccept: () => {},
  onStageAccept: () => {},
}))

test('a structured verdict shows its reason and findings', () => {
  const html = render({
    id: 'v1',
    kind: 'verdict',
    authorId: 'v1',
    ts: 1,
    text: 'REJECT 缺 beta',
    meta: {
      pass: false,
      stage: 1,
      judgment: {
        version: 1,
        type: 'verdict',
        decision: 'reject',
        reason: '缺 beta',
        findings: [{ title: 'shared.txt 只有 alpha', severity: 'blocker', evidence: 'cat' }],
        actionRequired: '',
        stage: 1,
        evidenceId: 'e1',
        actorId: 'v1',
        at: 1,
        source: 'json',
      },
    },
  })
  assert.match(html, /退回/)
  assert.match(html, /缺 beta/)
  assert.match(html, /阻断 · shared\.txt 只有 alpha/)
})

test('a legacy verdict still renders from its text', () => {
  const html = render({
    id: 'v2',
    kind: 'verdict',
    authorId: 'v1',
    ts: 1,
    text: 'PASS 内容正确\n测试通过',
    meta: { pass: true, reason: 'PASS 内容正确\n测试通过', stage: 1, evidenceId: 'e1' },
  })
  assert.match(html, /通过/)
  assert.match(html, /内容正确/)
})
