import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Fragment } from 'react'
import { ChatIsland } from './island.js'
import { ReceiptIntake } from './receipt-intake.js'
import { chatView } from './view.js'
import { StatePanel } from '../../state-panel.js'

const actions = {
  approval: () => {},
  continueChat: () => {},
  startStudio: () => {},
  chatAccept: () => {},
}

test('the chat header is the collapsed island', () => {
  const tree = chatView.header({
    room: {
      id: 'room-chat',
      name: '圆桌',
      goal: '讨论交付边界',
      state: 'active',
      chat: { phase: 'discussing' },
      messages: [],
    },
    members: [],
  })
  assert.equal(tree.type, Fragment)
  assert.equal(tree.props.children[0].type, ChatIsland)
})

test('chat participants show a body status row and can swap bodies', () => {
  const html = renderToStaticMarkup(chatView.header({
    room: {
      id: 'room-chat',
      name: '圆桌',
      goal: '讨论交付边界',
      state: 'active',
      chat: { phase: 'discussing' },
      messages: [],
      busyMembers: ['worker'],
    },
    members: [{ id: 'worker', name: '甲', role: 'worker', body: { engine: 'pi', model: 'deepseek-flash' } }],
    actions: { ...actions, swapBody: () => {} },
  }))
  assert.match(html, /成员状态/)
  assert.match(html, /发言中/)
  assert.match(html, /调整甲/)
})

test('a chat room shows the receipt strip before its timeline', () => {
  const receipt = {
    result: '发布检查',
    completeness: '2/2 阶段完成',
    checks: ['2/2 项检查通过'],
    openQuestions: [],
  }
  const tree = chatView.transcript({ room: { id: 'room-chat', receipt }, members: [], actions })
  const [strip, timeline] = tree.props.children.filter(Boolean)
  assert.equal(strip.type, ReceiptIntake)
  assert.deepEqual(strip.props.receipt, receipt)
  assert.equal(timeline.props.room.id, 'room-chat')
})

test('a plain chat room has no receipt to show', () => {
  const tree = chatView.transcript({ room: { id: 'room-chat' }, members: [], actions })
  const [strip] = tree.props.children.filter(Boolean)
  assert.equal(strip.props.receipt, undefined)
})

test('an empty chat room explains that its conclusion becomes studio work', () => {
  const tree = chatView.transcript({
    room: { id: 'room-chat', state: 'active', messages: [], chat: {} },
    members: [],
    actions,
  })
  const [intro] = tree.props.children.filter(Boolean)
  assert.equal(intro.type, StatePanel)
  assert.match(intro.props.title, /先聊清楚/)
  assert.match(intro.props.body, /工作室/)
})

test('a speaking member is left to the body status row', () => {
  const tree = chatView.typing({
    room: { id: 'room-chat', chat: { running: true, speaker: 'a' } },
    members: [{ id: 'a', name: '甲' }],
    locked: false,
  })
  assert.equal(tree, null)
})

test('only the host summarizing gets a typing line', () => {
  const html = renderToStaticMarkup(chatView.typing({
    room: { id: 'room-chat', chat: { phase: 'summarizing' } },
    members: [],
    locked: false,
  }))
  assert.match(html, /正在总结/)
})
