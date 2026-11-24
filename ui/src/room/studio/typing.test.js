import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TypingLine } from '../typing-line.js'
import { studioTyping } from './typing.js'

const members = [
  { id: 'lead', name: '规划师', role: 'lead' },
  { id: 'worker', name: '执行官', role: 'worker' },
  { id: 'worker-b', name: '执行官二号', roleKind: 'executor' },
  { id: 'verifier', name: '验收员', role: 'verifier' },
]

const room = overrides => ({ state: 'active', busyMembers: [], stages: [], ...overrides })

test('a busy executor names the step and its title', () => {
  const line = studioTyping(room({
    busyMembers: ['worker'],
    stages: [
      { title: '实现', state: 'passed' },
      { title: '写 verdict.txt', state: 'active' },
    ],
  }), members)
  assert.deepEqual(line, {
    label: '执行官',
    detail: '正在执行 · 第 2 步「写 verdict.txt」',
  })
})

test('roles pick the action before the stage exists', () => {
  assert.equal(studioTyping(room({ busyMembers: ['lead'] }), members).detail, '正在安排')
  assert.equal(studioTyping(room({ busyMembers: ['verifier'] }), members).detail, '正在复核')
})

test('mixed busy members fall back to parallel work', () => {
  const line = studioTyping(room({
    busyMembers: ['worker', 'verifier'],
    stages: [{ title: '实现', state: 'active' }],
  }), members)
  assert.equal(line.label, '执行官、验收员')
  assert.equal(line.detail, '正在一起处理 · 第 1 步「实现」')
})

test('the same role keeps its action for several members', () => {
  const line = studioTyping(room({
    busyMembers: ['worker', 'worker-b'],
    stages: [{ title: '实现', state: 'active' }],
  }), members)
  assert.equal(line.detail, '正在执行 · 第 1 步「实现」')
})

test('long stage titles are clipped', () => {
  const title = '把验收记录整理成一份可以交给下一位同事的完整说明，再补上每一步的检查结果和还没做的部分'
  const line = studioTyping(room({
    busyMembers: ['worker'],
    stages: [{ title, state: 'active' }],
  }), members)
  assert.ok(line.detail.endsWith('…」'))
  assert.ok(!line.detail.includes(title))
})

test('nothing is shown when the room is not active or nobody is busy', () => {
  assert.equal(studioTyping(room({ state: 'paused', busyMembers: ['worker'] }), members), null)
  assert.equal(studioTyping(room({ busyMembers: [] }), members), null)
})

test('the typing line renders the detail after the name', () => {
  const html = renderToStaticMarkup(h(TypingLine, {
    label: '执行官',
    detail: '正在执行 · 第 2 步「写 verdict.txt」',
  }))
  assert.match(html, /crew-typing-detail/)
  assert.match(html, /第 2 步/)
  assert.match(html, /crew-typing-dots/)
})

test('a running handoff shows what the executor is doing and for how long', () => {
  const now = Date.now()
  const line = studioTyping(room({
    assignments: [{ status: 'working', toMemberId: 'worker', updatedAt: now - 65_000 }],
    messages: [{ kind: 'activity', authorId: 'worker', ts: now - 65_000, text: 'Bash', meta: { action: 'exec', target: 'pip install opencv' } }],
    stages: [{ title: '高清化', state: 'active' }],
  }), members)
  assert.equal(line.label, '执行官')
  assert.match(line.detail, /正在执行/)
  assert.match(line.detail, /运行命令 pip install opencv/)
  assert.match(line.detail, /第 1 步「高清化」/)
  assert.match(line.detail, /1:0[0-9]/)
})

test('a gate submission does not leak the tool name into the live line', () => {
  const line = studioTyping(room({
    assignments: [{ status: 'working', toMemberId: 'verifier' }],
    messages: [{ kind: 'activity', authorId: 'verifier', text: '提交判定', meta: { action: 'gate', target: 'lodge_gate_submit_verdict' } }],
    stages: [{ title: '复核', state: 'active' }],
  }), members)
  assert.match(line.detail, /提交判定/)
  assert.equal(line.detail.includes('lodge_gate'), false)
})

test('a heredoc command is not printed in the live line', () => {
  const line = studioTyping(room({
    assignments: [{ status: 'working', toMemberId: 'worker' }],
    messages: [{ kind: 'activity', authorId: 'worker', text: 'Bash', meta: { action: 'exec', detail: "python3 -I - <<'EOF'\nimport re" } }],
    stages: [{ title: '整理', state: 'active' }],
  }), members)
  assert.equal(line.detail.includes('<<'), false)
  assert.match(line.detail, /运行命令/)
})

test('a just-sent user message says the planner is handling it', () => {
  const line = studioTyping(room({
    messages: [{ kind: 'chat', authorId: 'you', ts: Date.now() - 4_000, text: '用 Pillow' }],
    stages: [{ title: '高清化', state: 'active' }],
  }), members)
  assert.equal(line.label, '规划师')
  assert.match(line.detail, /正在处理 · 第 1 步「高清化」/)
})

test('waiting for the user never shows a fake typing line', () => {
  assert.equal(studioTyping(room({
    needsYou: { kind: 'approval' },
    assignments: [{ status: 'working', toMemberId: 'worker' }],
    messages: [{ kind: 'activity', authorId: 'worker', ts: Date.now() }],
  }), members), null)
})
