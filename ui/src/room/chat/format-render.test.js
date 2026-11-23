import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatLine } from '../../message-cards.js'

// 聊天室和工作室的成员发言都走 ChatLine；结构化回答要真的渲染成标题、列表和代码。
test('a structured answer keeps its headings, list and inline code in a bubble', () => {
  const html = renderToStaticMarkup(h(ChatLine, {
    message: {
      id: 'm1',
      kind: 'chat',
      authorId: 'worker',
      ts: 1795435627071,
      text: '## 判断题\n\n- **重复代码**：`turnFinal === false` 有三处判断\n- **数据泥团**：两个裸值穿四层',
    },
    member: { id: 'worker', name: '甲', role: 'worker', roleKind: 'participant' },
  }))
  assert.match(html, /<h2[^>]*>判断题<\/h2>/)
  assert.match(html, /<ul[^>]*>/)
  assert.match(html, /<li><strong>重复代码<\/strong>/)
  assert.match(html, /<code[^>]*>turnFinal === false<\/code>/)
})
