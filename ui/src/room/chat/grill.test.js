import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { chatView } from './view.js'

const actions = {
  approval: () => {},
  continueChat: () => {},
  startStudio: () => {},
  selectRoom: () => {},
}

test('chat has no grill button; the host decides when to ask', () => {
  const html = renderToStaticMarkup(chatView.header({
    room: {
      id: 'room-chat',
      name: '圆桌',
      goal: '讨论交付边界',
      state: 'active',
      live: true,
      chat: { phase: 'discussing' },
      messages: [],
    },
    members: [],
    actions,
  }))
  assert.doesNotMatch(html, /拷问我/)
})

test('a connection signal asks the room to reconnect', () => {
  let resumed = 0
  const tree = chatView.header({
    room: {
      id: 'room-chat',
      name: '圆桌',
      goal: '讨论交付边界',
      state: 'active',
      live: false,
      chat: { phase: 'discussing' },
      messages: [],
      needsYou: { kind: 'connection', label: '连接断了' },
    },
    members: [],
    actions: { ...actions, resume: () => { resumed += 1 } },
  })
  assert.equal(tree.props.onSignalAction({ needs: 'connection' }, {}), true)
  assert.equal(resumed, 1)
  assert.equal(tree.props.onSignalAction({ needs: 'decision' }, {}), false)
})
