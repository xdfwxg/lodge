import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatIsland, chatIslandState, chatIslandView } from './island.js'

test('chat island states stay short and carry a tone', () => {
  assert.deepEqual(chatIslandState({ key: 'chat-running' }), { label: '正在聊', tone: 'active' })
  assert.deepEqual(chatIslandState({ key: 'chat-decision' }), { label: '待确认', tone: 'waiting' })
  assert.deepEqual(chatIslandState({ key: 'chat-complete' }), { label: '结论已确认', tone: 'done' })
  assert.deepEqual(chatIslandState({ key: 'chat-interrupted' }), { label: '断了', tone: 'paused' })
})

test('an unknown decision keeps its own title and tone', () => {
  assert.deepEqual(
    chatIslandState({ key: 'approval', title: '连接中断', tone: 'paused' }),
    { label: '连接中断', tone: 'paused' },
  )
})

test('a pending conclusion grows the island into one decision', () => {
  const view = chatIslandView({
    decision: {
      key: 'chat-decision',
      detail: '先把返工台账做出来。',
      primary: { label: '确认结论', action: 'chat-accept' },
      secondary: { label: '再聊一轮', action: 'continue-chat' },
    },
  })
  assert.equal(view.label, '待确认')
  assert.equal(view.detail, '先把返工台账做出来。')
  assert.deepEqual(view.primary, { label: '确认结论', action: 'chat-accept' })
  assert.deepEqual(view.secondary, { label: '再聊一轮', action: 'continue-chat' })
})

test('a confirmed conclusion offers the one next step', () => {
  const view = chatIslandView({
    decision: { key: 'chat-complete', primary: { label: '用结论开工', action: 'start-studio' } },
  })
  assert.equal(view.label, '结论已确认')
  assert.deepEqual(view.primary, { label: '用结论开工', action: 'start-studio' })
  assert.equal(view.secondary, undefined)
})

test('interrupted chat resumes; an action the island cannot run is not shown', () => {
  const resume = chatIslandView({
    decision: { key: 'chat-interrupted', primary: { label: '重新开始', action: 'chat-resume' } },
  })
  assert.deepEqual(resume.primary, { label: '重新开始', action: 'chat-resume' })

  const paused = chatIslandView({
    decision: { key: 'paused', primary: { label: '继续', action: 'resume' } },
  })
  assert.equal(paused.primary, undefined)
})

test('the chat header uses the shared island', () => {
  const html = renderToStaticMarkup(h(ChatIsland, {
    room: { name: '圆桌' },
    decision: {
      key: 'chat-decision',
      detail: '先把返工台账做出来。',
      primary: { label: '确认结论', action: 'chat-accept' },
      secondary: { label: '再聊一轮', action: 'continue-chat' },
    },
  }))
  assert.match(html, /crew-island/)
  assert.match(html, /待确认/)
  assert.match(html, /先把返工台账做出来/)
  assert.match(html, /确认结论/)
  assert.match(html, /再聊一轮/)
})
