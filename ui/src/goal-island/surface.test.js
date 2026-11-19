import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GoalIsland } from './surface.js'

const actions = {
  toggleGoal: () => {},
  closeGoal: () => {},
  openSignal: () => {},
  actSignal: () => {},
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
  stages: [
    { n: 1, title: '目标对齐', status: 'active', kind: 'current' },
    { n: 2, title: '写欢迎语', status: 'pending', kind: 'upcoming' },
    { n: 3, title: '验收与结论', status: 'pending', kind: 'upcoming' },
  ],
}

const room = {
  id: 'room-1',
  name: '欢迎语落地',
  admin: 'lead',
  members: ['lead'],
  busy: false,
  needsYou: { kind: 'decision', label: '待确认' },
}

const goal = {
  status: 'active',
  current: 0,
  objective: '做一个欢迎语',
  stages: view.stages.map(stage => ({ title: stage.title, status: stage.status, kind: stage.kind })),
}

const render = (mode, signal, roomOverride = {}) => renderToStaticMarkup(h(GoalIsland, {
  room: { ...room, ...roomOverride },
  goal,
  view,
  mode,
  signal,
  actions,
  pill: h('button', { className: 'bt-pill' }, '打开'),
}))

test('the resting capsule is one small pill: the current step, no kicker', () => {
  const html = render('closed')
  assert.match(html, /data-compact="true"/)
  assert.match(html, /class="bt-goal-closed-title">目标对齐</)
  assert.doesNotMatch(html, /bt-goal-closed-kicker/)
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
  assert.match(html, /class="bt-goal-closed-kicker">欢迎语落地</)
  assert.doesNotMatch(html, /data-compact="true"/)
  assert.match(html, /bt-goal-signal/)
  assert.match(html, /第 1 步「目标对齐」有一处要你拍板/)
  assert.match(html, /aria-label="收起这条提醒"/)
  assert.doesNotMatch(html, /bt-pill/)
})

test('a review timeout puts the fix in the signal itself', () => {
  const html = render('decision', {
    key: 'decision:review-timeout:1',
    kind: 'decision',
    needs: 'review-timeout',
    stage: 1,
    tone: 'paused',
    title: '第 2 步「查机票」复核没按时回来',
    detail: '可以再叫一次复核，或退回重做。',
  })
  assert.match(html, /再叫一次复核/)
  assert.match(html, /退回重做/)
  assert.doesNotMatch(html, /去处理/)
})

test('the open panel is the goal, its steps and where the work stands', () => {
  const html = render('open', null, { attention: [], needsYou: null })
  assert.match(html, /做一个欢迎语/)
  assert.match(html, /目标对齐/)
  assert.match(html, /正在做/)
  assert.doesNotMatch(html, /详情/)
  assert.doesNotMatch(html, /检查/)
})

test('the open panel lists every waiting item, including a subroom', () => {
  const html = render('open', null, {
    attention: [
      { kind: 'signoff', stage: 0, label: '待签字' },
      { kind: 'decision', stage: 0, label: '待确认', roomId: 'child-1', roomName: '写欢迎语' },
    ],
  })
  assert.match(html, /需要你/)
  assert.match(html, /待签字/)
  assert.match(html, /写欢迎语/)
  assert.match(html, /去处理/)
})

test('a single waiting item keeps the old one-line warning', () => {
  const html = render('open', null, {
    attention: [{ kind: 'decision', stage: 0, label: '待确认' }],
  })
  assert.doesNotMatch(html, /需要你/)
  assert.match(html, /bt-goal-warn/)
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
