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
    ['running', 'waiting', 'idle', 'paused', 'stopped', 'done'],
  )
  assert.equal(ISLAND_STATUS.studio.idle.barLabel, '空闲中')
  assert.equal(ISLAND_STATUS.chat.idle.barLabel, '还没开始聊')
})

test('a studio shows the current step only while a turn is running', () => {
  assert.equal(islandStatusOf(studio({ busyMembers: ['worker'] })).key, 'running')
  assert.equal(islandStatusOf(studio({ busyMembers: ['worker'] })).barLabel, null)
  assert.equal(islandStatusOf(studio()).barLabel, '空闲中')
  assert.equal(islandStatusOf(studio({ needsYou: { kind: 'decision' } })).barLabel, '等你决定')
  assert.equal(islandStatusOf(studio({ state: 'paused' })).barLabel, '已暂停')
  assert.equal(islandStatusOf(studio({ state: 'stopped' })).barLabel, '已停止')
})

test('a chat derives the same state keys with its own words', () => {
  assert.equal(islandStatusOf(chat(), 'chat').key, 'idle')
  assert.equal(islandStatusOf(chat(), 'chat').barLabel, '还没开始聊')
  assert.equal(islandStatusOf(chat({ chat: { phase: 'discussing', running: true } }), 'chat').barLabel, '正在聊')
  assert.equal(islandStatusOf(chat({ chat: { phase: 'summarizing' } }), 'chat').barLabel, '正在收一下')
  assert.equal(islandStatusOf(chat({ chat: { phase: 'awaiting_decision' } }), 'chat').barLabel, '聊到这儿了')
  assert.equal(islandStatusOf(chat({ chat: { phase: 'accepted' } }), 'chat').barLabel, '聊完了')
  assert.equal(islandStatusOf(chat({ state: 'paused' }), 'chat').barLabel, '已暂停，随时接着聊')
})
