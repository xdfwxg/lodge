import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoomHealth, healthLineOf, healthOf } from './health.js'

const room = over => ({
  stages: [
    { title: '对齐', state: 'passed' },
    { title: '实现', state: 'active' },
  ],
  members: [{ id: 'executor', name: '执行官' }],
  stageDiagnostics: {
    1: {
      at: 100,
      memberId: 'executor',
      outcome: 'evidence',
      assessment: {
        evidence: ['耗时 2s', '证据：e1'],
        unknown: ['费用未知'],
        next: ['核对证据和交接状态，等待验收'],
      },
    },
  },
  usage: { turns: 2, costMicroUsd: 4200, costStatus: 'reported' },
  messages: [
    { kind: 'rework', meta: { stage: 1 } },
    { kind: 'human-context', meta: { stage: 1 } },
  ],
  needsYou: { label: '待确认', detail: '看一下结果' },
  ...over,
})

test('the health card reads the active stage diagnostic and room usage', () => {
  const health = healthOf(room())
  assert.equal(health.index, 1)
  assert.equal(health.title, '实现')
  assert.equal(health.memberName, '执行官')
  assert.equal(health.usage, '2 轮 · $0.0042')
  assert.equal(health.reworks, 1)
  assert.equal(health.human, 1)
  assert.equal(health.diagnostic.assessment.unknown[0], '费用未知')
  assert.equal(health.memoryCount, 0)
})

test('the first line asks what is needed, not how the factory is running', () => {
  const needs = healthLineOf(healthOf(room()))
  assert.equal(needs, '待处理：待确认')
  assert.doesNotMatch(needs, /\$|轮|重做|证据/)

  const running = healthLineOf(healthOf(room({ needsYou: null, busyMembers: ['executor'] })))
  assert.equal(running, '过程与费用')
  assert.doesNotMatch(running, /第 \d+ 步|执行官在做/)
})

test('a room without an active stage has no health card', () => {
  assert.equal(healthOf(room({ stages: [{ title: '对齐', state: 'passed' }] })), null)
})

test('an unknown cost reads as unknown, not zero', () => {
  const health = healthOf(room({ usage: { turns: 1, costMicroUsd: 0, costStatus: 'unknown' } }))
  assert.equal(health.usage, '1 轮 · 费用未知')
})

test('the process panel lists only real tool calls with their action', () => {
  const data = healthOf(room({
    messages: [
      { id: 'a1', kind: 'activity', authorId: 'executor', text: 'Bash', ts: 100, meta: { ok: true, tool: 'Bash', action: 'exec' } },
      { id: 'a2', kind: 'activity', authorId: 'executor', text: 'recent-work brief', ts: 101, meta: { ok: true } },
      { id: 'a3', kind: 'activity', authorId: 'executor', text: 'Edit', ts: 102, meta: { ok: false, tool: 'Edit', action: 'write' } },
    ],
  }))
  assert.deepEqual(data.tools.map(tool => [tool.name, tool.kind, tool.ok]), [['Bash', 'exec', true], ['Edit', 'write', false]])
  assert.equal(data.toolCount, 2)
})

test('room health renders the tool rows with their action glyph', () => {
  const html = renderToStaticMarkup(h(RoomHealth, {
    room: room({
      needsYou: null,
      messages: [
        { id: 'a1', kind: 'activity', authorId: 'executor', text: 'Bash', ts: 100, meta: { ok: true, tool: 'Bash', action: 'exec' } },
      ],
    }),
  }))
  assert.match(html, /crew-tool-row/)
  assert.match(html, /<code[^>]*>Bash<\/code>/)
  assert.match(html, /跑/)
})
