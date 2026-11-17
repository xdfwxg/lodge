import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GoalIsland } from './surface.js'

const actions = {
  toggleGoal: () => {},
  closeGoal: () => {},
  openSignal: () => {},
  dismissSignal: () => {},
  pauseSignal: () => {},
  resumeSignal: () => {},
  advance: () => {},
}

const view = {
  status: 'active',
  idle: false,
  title: '欢迎语落地',
  number: 1,
  count: 3,
  barLabel: '目标对齐',
  segments: ['current', 'todo', 'todo'],
  stages: [],
}

const room = {
  id: 'room-1',
  name: '欢迎语落地',
  admin: 'lead',
  members: ['lead'],
  busy: false,
  needsYou: { kind: 'decision', label: '待确认' },
}

const goal = { status: 'active', current: 0, stages: [], constraints: [] }

const render = (mode, signal) => renderToStaticMarkup(h(GoalIsland, {
  room,
  goal,
  view,
  mode,
  signal,
  roomWork: [],
  roster: { byId: {} },
  actions,
  pill: h('button', { className: 'bt-pill' }, '打开'),
}))

test('the compact capsule leads with the current step and keeps the goal above it', () => {
  const html = render('closed')
  assert.match(html, /class="bt-goal-closed-kicker">欢迎语落地</)
  assert.match(html, /class="bt-goal-closed-title">目标对齐</)
  assert.doesNotMatch(html, /1\/3/)
})

test('a decision renders one signal line and a dismiss control', () => {
  const html = render('decision', {
    key: 'decision:decision:0',
    kind: 'decision',
    tone: 'waiting',
    title: '第 1 步「目标对齐」有一处要你拍板',
    detail: '第 1 步 · 待确认',
  })
  assert.match(html, /data-mode="decision"/)
  assert.match(html, /bt-goal-signal/)
  assert.match(html, /第 1 步「目标对齐」有一处要你拍板/)
  assert.match(html, /aria-label="收起这条提醒"/)
  assert.doesNotMatch(html, /bt-pill/)
})

test('a milestone renders a polite announcement and no dismiss control', () => {
  const html = render('peek', {
    key: 'msg:2',
    kind: 'milestone',
    tone: 'done',
    title: '第 2 步「写欢迎语」通过',
    detail: '下一步：验收与结论',
  })
  assert.match(html, /data-mode="peek"/)
  assert.match(html, /role="status"/)
  assert.match(html, /第 2 步「写欢迎语」通过/)
  assert.doesNotMatch(html, /收起这条提醒/)
})
