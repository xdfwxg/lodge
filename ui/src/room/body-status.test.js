import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { bodyStatuses } from './body-status.js'
import { CrewStatusLine } from './crew-status.js'

const members = [
  { id: 'lead', name: '规划师', role: 'lead', body: { engine: 'claude', model: 'sonnet' } },
  { id: 'worker', name: '执行官', role: 'worker', body: { engine: 'pi', model: 'deepseek-flash' } },
  { id: 'verifier', name: '验收员', role: 'verifier', body: { engine: 'claude', model: 'sonnet' } },
]
const byId = list => Object.fromEntries(list.map(item => [item.memberId, item]))

test('idle bodies read as present, not as status noise', () => {
  const status = byId(bodyStatuses({ state: 'active' }, members))
  assert.equal(status.worker.label, '待命')
  assert.equal(status.worker.tone, 'idle')
})

test('a chat speaker shows as speaking and the queue shows as waiting', () => {
  const room = {
    state: 'active',
    busyMembers: ['worker'],
    chat: { running: true, speaker: 'worker' },
    turnQueue: [{ memberId: 'verifier', state: 'queued' }],
  }
  const status = byId(bodyStatuses(room, members, { labels: { member: '发言中' } }))
  assert.equal(status.worker.label, '发言中')
  assert.equal(status.verifier.label, '排队中')
})

test('working, queued and held bodies win over idle', () => {
  const room = {
    state: 'active',
    busyMembers: ['worker'],
    turnQueue: [{ memberId: 'verifier', state: 'queued' }],
    heldMembers: ['lead'],
  }
  const status = byId(bodyStatuses(room, members))
  assert.equal(status.worker.label, '处理中')
  assert.equal(status.worker.tone, 'active')
  assert.equal(status.verifier.label, '排队中')
  assert.equal(status.lead.label, '已叫停')
})

test('chat rooms can name speaking instead of processing', () => {
  const room = { state: 'active', busyMembers: ['worker'] }
  assert.equal(byId(bodyStatuses(room, members, { labels: { member: '发言中' } })).worker.label, '发言中')
})

test('a verifier working on its own vendor says self check, not independent review', () => {
  const room = { state: 'active', independence: 'none', busyMembers: ['verifier'] }
  assert.equal(byId(bodyStatuses(room, members)).verifier.label, '自查中')
  room.independence = 'vendor'
  assert.equal(byId(bodyStatuses(room, members)).verifier.label, '独立复核中')
})

test('a verifier waiting for the human keeps the self-check wording', () => {
  const room = { state: 'active', independence: 'none', needsYou: { kind: 'review' } }
  assert.equal(byId(bodyStatuses(room, members)).verifier.label, '自查中')
})

test('a sick body says why before anything else', () => {
  const room = {
    state: 'paused',
    memberError: { memberId: 'worker', kind: 'auth' },
    busyMembers: ['worker'],
  }
  const status = byId(bodyStatuses(room, members))
  assert.equal(status.worker.label, '登录失效')
  assert.equal(status.worker.tone, 'danger')
  assert.equal(status.verifier.label, '等待')
})

test('a broken connection marks every body offline', () => {
  const room = { state: 'active', connectionError: 'fetch failed' }
  assert.deepEqual(bodyStatuses(room, members).map(item => item.label), ['连接中断', '连接中断', '连接中断'])
})

test('the status line renders one quiet row with accessible labels', () => {
  const html = renderToStaticMarkup(h(CrewStatusLine, {
    room: { state: 'active', independence: 'none', busyMembers: ['worker'], busySince: Date.now() - 12_000 },
    members,
  }))
  assert.match(html, /aria-label="成员状态"/)
  assert.match(html, /执行官/)
  assert.match(html, /处理中/)
  assert.match(html, /12s/)
  assert.match(html, /验收员/)
})

test('a finished room does not keep a body status line', () => {
  const html = renderToStaticMarkup(h(CrewStatusLine, { room: { state: 'complete' }, members }))
  assert.equal(html, '')
})

test('a studio can add a member from the status row', () => {
  const html = renderToStaticMarkup(h(CrewStatusLine, {
    room: { state: 'active' },
    members,
    onSwap: () => {},
    onAdd: () => {},
  }))
  assert.match(html, /添加成员/)
})

test('each body is a button that opens the swap dialog', () => {
  const html = renderToStaticMarkup(h(CrewStatusLine, {
    room: { state: 'active' },
    members,
    onSwap: () => {},
  }))
  assert.match(html, /aria-label="调整执行官"/)
  assert.match(html, /button/)
})
