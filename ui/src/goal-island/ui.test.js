import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// Rendering harness adapted from Claude-Bot (Apache-2.0),
// ds-bot/test/goal-client.test.js: bundle the client module and run it with a
// tiny React stand-in; no browser or DOM dependency.
const makeReact = (states = []) => ({
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: 'fragment',
  useState: initial => [states.length > 0 ? states.shift() : initial, () => {}],
  useEffect: () => {},
})

const load = async (states = []) => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./index.js', import.meta.url))],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    loader: { '.css': 'empty' },
    external: ['react'],
  })
  const react = makeReact(states)
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: name => (name === 'react' ? react : (() => { throw new Error(`no platform module ${name}`) })()),
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    console,
  })
  return module.exports
}

const render = node => {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (typeof node.type === 'function') return render(node.type(node.props))
  return { ...node, children: (node.children ?? []).map(render) }
}
const hasClass = (node, cls) => (node?.props?.className ?? '').split(' ').includes(cls)
const find = (node, cls) => {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (hasClass(node, cls)) return node
  for (const child of node.children ?? []) {
    const found = find(child, cls)
    if (found !== null) return found
  }
  return null
}
const findAll = (node, cls, out = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (hasClass(node, cls)) out.push(node)
  for (const child of node.children ?? []) findAll(child, cls, out)
  return out
}
const text = node => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  return (node.children ?? []).map(text).join('')
}
const button = (tree, label) => findAll(tree, 'crew-ghost').find(node => text(node) === label)
  ?? findAll(tree, 'crew-choice').find(node => text(node) === label)

const seats = {
  worker: { id: 'worker', name: '前端', role: 'worker' },
  verifier: { id: 'verifier', name: '复核', role: 'verifier' },
}

const stage = (over = {}) => ({
  index: 1,
  title: '实现保存',
  kind: 'deliverable',
  state: 'active',
  acceptance: 'npm test',
  acceptanceLabel: 'npm test',
  dependsOn: [],
  partial: null,
  partialFailedNames: [],
  conflict: null,
  reworkCount: 2,
  rework: [
    { id: 'r2', author: '复核', at: Date.UTC(2026, 10, 12, 3, 37), text: 'REJECT：刷新后没有重新读取' },
    { id: 'r1', author: '复核', at: Date.UTC(2026, 10, 12, 3, 36), text: 'REJECT：设置项少了主题色' },
  ],
  evidence: [{ id: 'e1', href: '/api/rooms/room-1/evidence/e1', manual: false, command: 'npm test', exit: 0 }],
  verdict: null,
  tasks: [{ id: '1:worker', title: '前端', owner: 'worker', status: 'reported', evidenceRef: 'e1', seat: seats.worker }],
  otherSeats: [{ seat: seats.verifier, state: 'done', task: '独立复跑，给 PASS 或 REJECT' }],
  ...over,
})

const view = (over = {}) => ({
  id: 'room-1',
  name: '设置页保存',
  goal: '给设置页加保存，并保证刷新后生效',
  state: 'active',
  brief: { objective: '给设置页加保存，并保证刷新后生效', done: [{ done: false, text: '保存后刷新仍生效' }], constraints: ['不改上游'] },
  status: { label: '验收退回 · 等你处理', tone: 'paused' },
  badges: [{ label: '独立性降级', warn: true }, { label: '实时' }],
  progress: { value: 2, total: 3 },
  track: ['passed', 'active', 'pending'],
  faces: [{ seat: seats.worker, live: true }, { seat: seats.verifier, live: false }],
  answers: { goal: '给设置页加保存，并保证刷新后生效', progress: '2/3 · 实现保存' },
  stages: [
    stage({ index: 0, title: '对齐接口', kind: 'decision', state: 'passed', acceptance: null, acceptanceLabel: '你点过才算过', reworkCount: 0, rework: [], evidence: [], tasks: [], otherSeats: [] }),
    stage(),
    stage({ index: 2, title: '回归', state: 'pending', acceptance: 'npm run e2e', acceptanceLabel: 'npm run e2e', reworkCount: 0, rework: [], evidence: [], tasks: [], otherSeats: [] }),
  ],
  controls: { canPause: true, canResume: false, canStop: true, canContinue: false },
  ...over,
})

test('the closed island renders the full goal, progress, track and task faces', async () => {
  const { GoalIsland } = await load()
  const tree = render(GoalIsland({
    view: view(),
    advanced: false,
    actions: {},
  }))
  const island = find(tree, 'crew-island')
  assert.ok(island)
  assert.equal(island.props['data-open'], false)
  assert.equal(text(find(tree, 'crew-island-top').children.find(child => child.type === 'h1')), '给设置页加保存，并保证刷新后生效')
  assert.equal(findAll(tree, 'crew-badge').length, 0)
  assert.equal(text(find(tree, 'crew-island-pill')), '2/3⌄')
  assert.deepEqual(findAll(tree, 'crew-island-track')[0].children.map(node => node.props['data-tone']), ['passed', 'active', 'pending'])
  assert.equal(findAll(tree, 'crew-island-faces')[0].children.filter(Boolean).length, 2)
  assert.equal(find(tree, 'crew-island-panel'), null)
})

test('the open island renders answers, steps, rework, tasks, evidence and controls', async () => {
  const { GoalIsland } = await load([true, null, false])
  const calls = []
  const tree = render(GoalIsland({
    view: view(),
    advanced: false,
    actions: {
      review: () => calls.push('review'),
      toggleAdvanced: () => calls.push('advanced'),
      pause: () => calls.push('pause'),
      resume: () => {},
      stop: () => calls.push('stop'),
    },
  }))
  const panel = find(tree, 'crew-island-panel')
  assert.ok(panel)
  assert.equal(panel.props.role, 'region')
  assert.deepEqual(findAll(tree, 'crew-island-answer').map(node => text(node)), ['目标给设置页加保存，并保证刷新后生效', '进度2/3 · 实现保存', '怎么算过npm test'])
  assert.deepEqual(findAll(tree, 'crew-island-meta')[0].children.map(node => text(node)), ['独立性降级', '实时'])
  assert.equal(findAll(tree, 'crew-step-node').length, 3)
  assert.equal(findAll(tree, 'crew-step-node')[1].props['aria-current'], 'step')
  assert.equal(find(tree, 'crew-island-rework-author') && text(find(tree, 'crew-island-rework-author')), '复核')
  assert.equal(findAll(tree, 'crew-island-rework-item').length, 2)
  assert.equal(text(find(tree, 'crew-island-task')), '前前端证据已交')
  assert.equal(find(tree, 'crew-island-task-evidence').props.href, '/api/rooms/room-1/evidence/e1')
  assert.equal(find(tree, 'crew-island-evidence-link').props.href, '/api/rooms/room-1/evidence/e1')
  const footer = findAll(tree, 'crew-island-foot')[0]
  assert.deepEqual(footer.children.filter(node => node && node.type === 'button').map(node => text(node)), ['复盘', '高级', '暂停', '停止'])
  button(tree, '复盘').props.onClick()
  button(tree, '高级').props.onClick()
  button(tree, '暂停').props.onClick()
  assert.equal(button(tree, '停止') !== undefined, true)
  assert.deepEqual(calls, ['review', 'advanced', 'pause'])
})

test('an armed stop button invokes the stop action', async () => {
  const { GoalIsland } = await load([true, null, true])
  const calls = []
  const tree = render(GoalIsland({ view: view(), advanced: false, actions: { review: () => {}, toggleAdvanced: () => {}, stop: () => calls.push('stop') } }))
  button(tree, '再点一次确认停止').props.onClick()
  assert.deepEqual(calls, ['stop'])
})

test('a completed island exposes only the continue action in the footer', async () => {
  const { GoalIsland } = await load([true, null, false])
  const calls = []
  const tree = render(GoalIsland({
    view: view({
      state: 'complete',
      controls: { canPause: false, canResume: false, canStop: false, canContinue: true },
    }),
    advanced: false,
    actions: { review: () => {}, toggleAdvanced: () => {}, continue: () => calls.push('continue') },
  }))
  assert.ok(button(tree, '基于此记录续做'))
  assert.equal(button(tree, '暂停'), undefined)
  assert.equal(button(tree, '停止'), undefined)
  button(tree, '基于此记录续做').props.onClick()
  assert.deepEqual(calls, ['continue'])
})
