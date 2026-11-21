import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { GoalIslandHeader } from '../../goal-island/adapter.js'
import { ReceiptIntake } from './receipt-intake.js'
import { chatView } from './view.js'
import { StatePanel } from '../../state-panel.js'

const actions = {
  approval: () => {},
  continueChat: () => {},
  startStudio: () => {},
  selectRoom: () => {},
}

test('the chat header is the same goal island as the studio', () => {
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
    actions,
  })
  assert.equal(tree.type, GoalIslandHeader)
})

test('a paused chat room shows the fix instead of hiding it in the sidebar', () => {
  const html = renderToStaticMarkup(chatView.header({
    room: {
      id: 'room-chat',
      name: '圆桌',
      goal: '讨论交付边界',
      state: 'paused',
      pauseReason: 'member_error',
      memberError: { memberId: 'worker', kind: 'auth' },
      chat: { phase: 'discussing' },
      messages: [],
    },
    members: [],
    actions: { ...actions, resume: () => {}, swapBody: () => {} },
  }))
  assert.match(html, /重新登录/)
  assert.match(html, /继续/)
})

test('the chat header leaves the crew to the sidebar', () => {
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
    actions,
  }))
  assert.match(html, /crew-goal-island/)
  assert.match(html, /圆桌/)
  assert.doesNotMatch(html, /成员状态/)
  assert.doesNotMatch(html, /发言中/)
})

test('the island carries one lingchong, busy while working and settled when done', () => {
  const busy = renderToStaticMarkup(chatView.header({
    room: {
      id: 'room-chat',
      name: '圆桌',
      goal: '讨论交付边界',
      state: 'active',
      chat: { phase: 'discussing' },
      messages: [],
      busyMembers: ['worker'],
    },
    members: [],
    actions,
  }))
  assert.match(busy, /class="lingchong"[^>]*data-state="busy"/)
  assert.match(busy, /data-state="busy"[^>]*data-gait="run"/)
  assert.match(busy, /lingchong-art/)
  // 安静聊天收成小胶囊时，灵宠仍在小胶囊上陪着，不随胶囊消失。
  const idle = renderToStaticMarkup(chatView.header({
    room: {
      id: 'room-chat',
      name: '圆桌',
      goal: '讨论交付边界',
      state: 'active',
      chat: { phase: 'discussing' },
      messages: [],
    },
    members: [],
    actions,
  }))
  assert.match(idle, /data-mini="true"/)
  assert.match(idle, /class="lingchong"[^>]*data-state="rest"/)
  const done = renderToStaticMarkup(h(GoalIslandHeader, {
    room: {
      id: 'room-studio',
      name: '做出来',
      goal: '把结尾改好',
      state: 'idle',
      workRound: { id: 'round-1', status: 'completed' },
      stages: [{ title: '改结尾', state: 'passed' }],
      messages: [],
    },
    members: [],
    onOpenRoom: () => {},
  }))
  assert.match(done, /class="lingchong"[^>]*data-state="done"/)
})

test('a demo chat says it cannot continue instead of promising a reply', () => {
  assert.equal(
    chatView.composerPlaceholder({ room: { state: 'complete', demo: true, live: false } }),
    '示例房间不接模型 · 已停在结论',
  )
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

test('an empty chat room invites a chat without demanding a conclusion', () => {
  const tree = chatView.transcript({
    room: { id: 'room-chat', state: 'active', messages: [], chat: {} },
    members: [],
    actions,
  })
  const [intro] = tree.props.children.filter(Boolean)
  assert.equal(intro.type, StatePanel)
  assert.match(intro.props.title, /随便聊聊/)
  assert.match(intro.props.body, /想聊就聊/)
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

test('the host shows a pending line while it reads the input', () => {
  const html = renderToStaticMarkup(chatView.typing({
    room: { chat: { hostThinking: true }, hostLabel: 'Lodge 主持' },
    members: [],
    locked: false,
  }))
  assert.match(html, /Lodge 主持 正在看/)
})

test('only the host summarizing gets a typing line', () => {
  const html = renderToStaticMarkup(chatView.typing({
    room: { id: 'room-chat', chat: { phase: 'summarizing' } },
    members: [],
    locked: false,
  }))
  assert.match(html, /正在总结/)
  assert.match(html, /crew-msg-chat/)
  assert.doesNotMatch(html, /crew-msg-avatar/)
})
