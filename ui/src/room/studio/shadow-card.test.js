import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShadowCard } from './shadow-card.js'

test('the shadow card renders the verifier verdict beside advisor advice', () => {
  const room = {
    seatSpecs: [{ id: 'verifier', name: '验收员' }],
    messages: [
      {
        id: 'v1',
        kind: 'verdict',
        authorId: 'verifier',
        text: 'PASS',
        meta: { evidenceId: 'e1', pass: true, stage: 0 },
      },
      {
        id: 'a1',
        kind: 'advisor_advice',
        meta: {
          evidenceId: 'e1',
          shadow: true,
          model: 'advisor-test',
          advice: [{ score: 0.8, summary: '建议补一条回滚测试', reasons: ['缺少边界用例'] }],
        },
      },
    ],
  }
  const html = renderToStaticMarkup(h(ShadowCard, { room, message: room.messages[0] }))
  assert.match(html, /影子评审/)
  assert.match(html, /一致/)
  assert.match(html, /验收员 · 正式/)
  assert.match(html, /advisor · 仅对照/)
  assert.match(html, /0\.80/)
  assert.match(html, /建议补一条回滚测试/)
})
