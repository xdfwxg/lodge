import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { chatView } from './view.js'

const actions = {
  approval: () => {},
  continueChat: () => {},
  startStudio: () => {},
  selectRoom: () => {},
  send: () => {},
}

test('an active chat offers a grill entry to the host', () => {
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
  assert.match(html, /拷问我/)
})
