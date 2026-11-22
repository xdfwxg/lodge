import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderStudioMessage } from './message-view.js'

const render = message => renderToStaticMarkup(renderStudioMessage({
  room: { id: 'room-1', messages: [] },
  byId: { v1: { id: 'v1', name: '验收员', roleKind: 'verifier' } },
  message,
  timeline: {},
  onAccept: () => {},
  onStageAccept: () => {},
}))

test('a structured verdict shows its reason and findings', () => {
  const html = render({
    id: 'v1',
    kind: 'verdict',
    authorId: 'v1',
    ts: 1,
    text: 'REJECT 缺 beta',
    meta: {
      pass: false,
      stage: 1,
      judgment: {
        version: 1,
        type: 'verdict',
        decision: 'reject',
        reason: '缺 beta',
        findings: [{ title: 'shared.txt 只有 alpha', severity: 'blocker', evidence: 'cat' }],
        actionRequired: '',
        stage: 1,
        evidenceId: 'e1',
        actorId: 'v1',
        at: 1,
        source: 'json',
      },
    },
  })
  assert.match(html, /退回/)
  assert.match(html, /缺 beta/)
  assert.match(html, /阻断 · shared\.txt 只有 alpha/)
})

test('a verdict without a contract still renders from its text', () => {
  const html = render({
    id: 'v2',
    kind: 'verdict',
    authorId: 'v1',
    ts: 1,
    text: 'PASS 内容正确\n测试通过',
    meta: { pass: true, reason: 'PASS 内容正确\n测试通过', stage: 1, evidenceId: 'e1' },
  })
  assert.match(html, /通过/)
  assert.match(html, /内容正确/)
})

test('a pass with no action does not leave an empty reason fold', () => {
  const html = render({
    id: 'v3',
    kind: 'verdict',
    authorId: 'v1',
    ts: 1,
    text: 'todo.md 三行待办，每行一条，符合目标。',
    meta: {
      pass: true,
      judgment: {
        decision: 'pass',
        reason: 'todo.md 三行待办，每行一条，符合目标。',
        findings: [],
        actionRequired: '无',
      },
    },
  })
  assert.match(html, /符合目标/)
  assert.doesNotMatch(html, /理由/)
})

test('a system handoff is spoken by the member who sent it', () => {
  const room = {
    id: 'room-1',
    messages: [],
    members: [
      { id: 'planner', name: '规划师', roleKind: 'planner' },
      { id: 'executor', name: '执行官', roleKind: 'executor' },
    ],
  }
  const byId = Object.fromEntries(room.members.map(member => [member.id, member]))
  const html = renderToStaticMarkup(renderStudioMessage({
    room,
    byId,
    message: {
      id: 'h1',
      kind: 'system',
      ts: 1,
      text: '@执行官 第 1 步「改标题」交给你。',
      meta: { kind: 'handoff', stage: 0, from: 'planner', to: ['executor'] },
    },
    timeline: {},
    onAccept: () => {},
    onStageAccept: () => {},
  }))
  assert.match(html, /crew-msg-chat/)
  assert.match(html, /规划师/)
  assert.doesNotMatch(html, /crew-system/)
})

test('an older handoff without a sender falls back to the lead', () => {
  const room = {
    id: 'room-1',
    messages: [],
    members: [
      { id: 'planner', name: '规划师', roleKind: 'planner' },
      { id: 'executor', name: '执行官', roleKind: 'executor' },
    ],
  }
  const byId = Object.fromEntries(room.members.map(member => [member.id, member]))
  const html = renderToStaticMarkup(renderStudioMessage({
    room,
    byId,
    message: {
      id: 'h2',
      kind: 'system',
      ts: 1,
      text: '@执行官 第 1 步「改标题」交给你。',
      meta: { kind: 'handoff', stage: 0, to: ['executor'] },
    },
    timeline: {},
    onAccept: () => {},
    onStageAccept: () => {},
  }))
  assert.match(html, /规划师/)
  assert.doesNotMatch(html, /crew-system/)
})
