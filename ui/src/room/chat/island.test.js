import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatIsland, chatIslandState, chatIslandView } from './island.js'

test('chat island states stay short and carry a tone', () => {
  assert.deepEqual(chatIslandState({ key: 'chat-running' }), { label: '正在聊', tone: 'active' })
  assert.deepEqual(chatIslandState({ key: 'chat-concluded' }), { label: '聊完了', tone: 'done' })
  assert.deepEqual(chatIslandState({ key: 'chat-interrupted' }), { label: '断了', tone: 'paused' })
})

test('an unknown decision keeps its own title and tone', () => {
  assert.deepEqual(
    chatIslandState({ key: 'approval', title: '连接中断', tone: 'paused' }),
    { label: '连接中断', tone: 'paused' },
  )
})

test('a conclusion is a quiet status, not a decision', () => {
  const view = chatIslandView({
    decision: {
      key: 'chat-concluded',
      detail: '先把返工台账做出来。',
      primary: null,
      secondary: null,
    },
  })
  assert.equal(view.label, '聊完了')
  assert.equal(view.detail, '先把返工台账做出来。')
  assert.equal(view.primary, undefined)
  assert.equal(view.secondary, undefined)
})

test('an old work action never grows on the island', () => {
  const view = chatIslandView({
    decision: { key: 'chat-concluded', primary: { label: '转成工作室任务', action: 'start-studio' } },
  })
  assert.equal(view.label, '聊完了')
  assert.equal(view.primary, undefined)
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
      key: 'chat-interrupted',
      detail: '刚才断了，可以重新开始。',
      primary: { label: '重新开始', action: 'chat-resume' },
      secondary: null,
    },
  }))
  assert.match(html, /crew-island/)
  assert.match(html, /断了/)
  assert.match(html, /重新开始/)
  assert.doesNotMatch(html, /确认结论/)
})
