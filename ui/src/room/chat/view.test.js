import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatIsland } from './island.js'
import { ReceiptIntake } from './receipt-intake.js'
import { chatView } from './view.js'

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
  assert.equal(tree.type, ChatIsland)
})

test('a chat room shows the receipt strip before its timeline', () => {
  const receipt = {
    result: '发布检查',
    completeness: '2/2 阶段完成',
    checks: ['2/2 项检查通过'],
    openQuestions: [],
  }
  const tree = chatView.transcript({ room: { id: 'room-chat', receipt }, members: [], actions })
  const [strip, timeline] = tree.props.children
  assert.equal(strip.type, ReceiptIntake)
  assert.deepEqual(strip.props.receipt, receipt)
  assert.equal(timeline.props.room.id, 'room-chat')
})

test('a plain chat room has no receipt to show', () => {
  const tree = chatView.transcript({ room: { id: 'room-chat' }, members: [], actions })
  const [strip] = tree.props.children
  assert.equal(strip.props.receipt, undefined)
})

test('a typing member says it is thinking without repeating the name', () => {
  const html = renderToStaticMarkup(chatView.typing({
    room: { id: 'room-chat', chatBusyMember: 'a', chatWorking: true },
    members: [{ id: 'a', name: '甲' }],
    locked: false,
  }))
  assert.match(html, /正在思考/)
  assert.doesNotMatch(html, /甲 正在思考/)
})
