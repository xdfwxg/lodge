import assert from 'node:assert/strict'
import test from 'node:test'
import { buildResources } from './resources.js'

test('resource panel aggregates room state, cost and failures without routing', () => {
  const rooms = [
    { id: 'r1', name: '一', state: 'active', usage: { costMicroUsd: 100, turns: 2 }, stages: [{ title: '对齐', kind: 'decision', state: 'active' }] },
    { id: 'r2', name: '二', state: 'paused', usage: { costMicroUsd: 300, turns: 4 }, stages: [{ partial: { failed: ['乙'] } }], mergeConflict: { stage: 0 } },
    { id: 'r3', name: '三', state: 'complete', usage: { costMicroUsd: 0, turns: 1 }, stages: [] },
  ]
  const messages = {
    r1: [
      { kind: 'evidence', meta: { kind: 'command', exit: 1 } },
      { kind: 'verdict', meta: { pass: false } },
    ],
    r2: [],
    r3: [],
  }
  const resources = buildResources(rooms, id => messages[id] ?? [])
  assert.deepEqual(resources.global, {
    rooms: 3,
    active: 1,
    paused: 1,
    stopped: 0,
    complete: 1,
    needsYou: 1,
    costMicroUsd: 400,
    budgetMicroUsd: 0,
    turns: 7,
    failedCommands: 1,
    rework: 1,
    conflicts: 1,
    partial: 1,
  })
  assert.deepEqual(resources.rooms.map(item => item.roomId), ['r2', 'r1', 'r3'])
  assert.equal(resources.rooms[1].needsYou.label, '等你确认')
  assert.deepEqual(resources.deliveries.map(item => item.roomId), ['r3'])
})
