import assert from 'node:assert/strict'
import test from 'node:test'
import { ISLAND_STATUS, islandStatusOf } from './status.js'

const studio = over => ({
  state: 'active',
  busyMembers: [],
  needsYou: null,
  ...over,
})

const chat = over => ({
  state: 'active',
  chat: { phase: 'discussing' },
  messages: [],
  ...over,
})

test('studio and chat share state keys but keep separate words', () => {
  assert.deepEqual(Object.keys(ISLAND_STATUS), ['studio', 'chat'])
  assert.deepEqual(
    Object.keys(ISLAND_STATUS.studio),
    ['running', 'waiting', 'idle', 'paused', 'stopped', 'archived', 'done'],
  )
  assert.equal(ISLAND_STATUS.studio.idle.barLabel, '空闲中')
  assert.equal(ISLAND_STATUS.chat.idle.barLabel, '还没开始聊')
})

test('a studio with a live round is working, not idle', () => {
  assert.equal(islandStatusOf(studio({ busyMembers: ['worker'] })).key, 'running')
  assert.equal(islandStatusOf(studio({ busyMembers: ['worker'] })).barLabel, null)
  assert.equal(islandStatusOf(studio()).key, 'running')
  assert.equal(islandStatusOf(studio()).stageLabel, '进行中')
  assert.equal(islandStatusOf(studio({ needsYou: { kind: 'decision' } })).barLabel, '等你决定')
  assert.equal(islandStatusOf(studio({ state: 'paused' })).barLabel, '已暂停')
  assert.equal(islandStatusOf(studio({ state: 'stopped' })).barLabel, '已停止')
  assert.equal(islandStatusOf(studio({ archivedAt: 1 })).barLabel, '已归档')
  assert.equal(islandStatusOf(studio({ archivedAt: 1, busyMembers: ['worker'] })).key, 'archived')
  assert.equal(islandStatusOf(studio({ state: 'idle', activeRoundId: null })).barLabel, '空闲中')
})

test('a chat derives the same state keys with its own words', () => {
  assert.equal(islandStatusOf(chat(), 'chat').key, 'idle')
  assert.equal(islandStatusOf(chat(), 'chat').barLabel, '还没开始聊')
  assert.equal(islandStatusOf(chat({ chat: { phase: 'discussing', running: true } }), 'chat').barLabel, '正在聊')
  assert.equal(islandStatusOf(chat({ chat: { phase: 'summarizing' } }), 'chat').barLabel, '正在收一下')
  assert.equal(islandStatusOf(chat({ chat: { phase: 'concluded' } }), 'chat').barLabel, '聊到这儿了')
  assert.equal(islandStatusOf(chat({ state: 'paused' }), 'chat').barLabel, '已暂停，随时接着聊')
  assert.equal(islandStatusOf(chat({ archivedAt: 1, chat: { phase: 'discussing', running: true } }), 'chat').key, 'archived')
  assert.equal(islandStatusOf(chat({ archivedAt: 1 }), 'chat').barLabel, '已归档')
})

test('an idle studio is only done when the latest round completed', () => {
  assert.equal(islandStatusOf(studio({
    state: 'idle',
    activeRoundId: null,
    workRound: { id: 'round-2', status: 'stopped' },
    rounds: [{ id: 'round-1', status: 'completed' }, { id: 'round-2', status: 'stopped' }],
  })).key, 'idle')
  assert.equal(islandStatusOf(studio({
    state: 'active',
    activeRoundId: 'round-2',
    workRound: { id: 'round-2', status: 'active' },
    rounds: [{ id: 'round-1', status: 'completed' }],
  })).key, 'running')
  assert.equal(islandStatusOf(studio({
    state: 'idle',
    activeRoundId: null,
    workRound: { id: 'round-1', status: 'completed' },
  })).key, 'done')
})

test('a working room and an idle room with a pending need are not idle', () => {
  assert.equal(islandStatusOf(studio({ working: true })).key, 'running')
  assert.equal(islandStatusOf(studio({ state: 'idle', activeRoundId: null, needsYou: { kind: 'rework', stage: 0 } })).key, 'waiting')
  assert.equal(islandStatusOf(studio({ state: 'idle', activeRoundId: null, needsYou: { kind: 'signoff', stage: 0, actionable: false } })).key, 'idle')
})
