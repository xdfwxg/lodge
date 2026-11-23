import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const nodeRequire = createRequire(import.meta.url)

const load = async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./transcript.js', import.meta.url))],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    external: ['react'],
  })
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment',
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useMemo: factory => factory(),
    useRef: () => ({ current: null }),
    useEffect: () => {},
  }
  const jsx = (type, props) => ({
    type,
    props: props ?? {},
    children: [].concat(props?.children ?? []).flat(Infinity),
  })
  const jsxRuntime = { Fragment: 'fragment', jsx, jsxs: jsx, jsxDEV: jsx }
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: name => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return jsxRuntime
      if (name.startsWith('node:')) return nodeRequire(name)
      throw new Error(`no platform module ${name}`)
    },
    Intl,
    Date,
  })
  return module.exports
}

const render = node => {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (typeof node.type === 'function') return render(node.type(node.props))
  return { ...node, children: (node.children ?? []).map(render) }
}
const text = node => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  return (node.children ?? []).map(text).join('')
}
const hasClass = (node, name) => {
  if (node === null || node === undefined || typeof node !== 'object') return false
  if (typeof node.props?.className === 'string' && node.props.className.split(/\s+/).includes(name)) return true
  return (node.children ?? []).some(child => hasClass(child, name))
}

const countClass = (node, name) => {
  if (node === null || node === undefined || typeof node !== 'object') return 0
  const own = typeof node.props?.className === 'string' && node.props.className.split(/\s+/).includes(name) ? 1 : 0
  return own + (node.children ?? []).reduce((sum, child) => sum + countClass(child, name), 0)
}

const members = [{ id: 'lead', name: '规划师', role: 'lead', roleKind: 'planner' }]

const finishedRoom = () => ({
  id: 'room-1',
  name: '设置页保存',
  goal: '保存后刷新仍生效',
  state: 'complete',
  messages: [{ kind: 'chat', id: 'm1', authorId: 'lead', text: '这是工厂里的过程话', ts: 1, seq: 1 }],
  stages: [{
    index: 0,
    title: '实现',
    kind: 'deliverable',
    state: 'passed',
    acceptance: 'npm test',
    commands: [],
    verdicts: [],
    changedFiles: [],
  }],
})

const delivery = {
  name: '设置页保存',
  goal: '保存后刷新仍生效',
  stages: [],
  commands: [],
  changedFiles: [],
}

test('the same visible status notice is kept only once, at its latest position', async () => {
  const { dedupeSystemNotices } = await load()
  const notice = (id, text) => ({
    id,
    kind: 'system',
    text,
    meta: { kind: 'notice', show: true },
  })
  const messages = [
    notice('n1', '规划师没有开口，这一步还没开始。'),
    { id: 'chat', kind: 'chat', text: '继续' },
    notice('n2', '规划师没有开口，这一步还没开始。'),
    notice('n3', '这一步需要你补一句上下文。'),
  ]
  assert.deepEqual(
    dedupeSystemNotices(messages).map(message => message.id),
    ['chat', 'n2', 'n3'],
  )
})

test('a finished room keeps the work record open and ends with the result', async () => {
  const { StudioTranscript } = await load()
  const room = finishedRoom()
  const tree = render(StudioTranscript({ room, members, delivery }))
  assert.match(text(tree), /设置页保存/)
  assert.equal(hasClass(tree, 'studio-timeline'), true)
  assert.equal(hasClass(tree, 'studio-process'), false)
  assert.equal(hasClass(tree, 'studio-result'), true)
})

test('a finished round keeps shadow advice off the result path', async () => {
  const { StudioTranscript } = await load()
  const room = {
    ...finishedRoom(),
    advisorShadow: {
      0: { evidenceId: 'e0', advice: [{ summary: '本轮意见' }] },
      1: { evidenceId: 'e1', advice: [{ summary: '上一轮意见' }] },
    },
  }
  const tree = render(StudioTranscript({ room, members, delivery }))
  assert.doesNotMatch(text(tree), /本轮意见|上一轮意见/)
})

test('a summary and a duplicate conclusion stay out of the result path', async () => {
  const { StudioTranscript } = await load()
  const room = {
    ...finishedRoom(),
    messages: [
      { id: 'c1', kind: 'conclusion', authorId: 'lead', text: '已交付：设置页保存', ts: 1, seq: 1 },
      { id: 'late', kind: 'chat', authorId: 'lead', text: '这一步通过了，下一步由你确认', ts: 2, seq: 2 },
    ],
  }
  const tree = render(StudioTranscript({ room, members, delivery }))
  assert.doesNotMatch(text(tree), /下一步由你确认/)
  assert.doesNotMatch(text(tree), /已交付：设置页保存/)
})

test('a room still at work keeps the transcript on screen', async () => {
  const { StudioTranscript } = await load()
  const room = {
    ...finishedRoom(),
    state: 'active',
    stages: [{ ...finishedRoom().stages[0], state: 'active' }],
  }
  const tree = render(StudioTranscript({ room, members, delivery: null }))
  assert.equal(hasClass(tree, 'studio-timeline'), true)
  assert.doesNotMatch(text(tree), /工作记录/)
})

test('a one-click rework reads as the room acting, not as words the user typed', async () => {
  const { StudioTranscript } = await load()
  const room = {
    ...finishedRoom(),
    state: 'active',
    stages: [{ ...finishedRoom().stages[0], state: 'active' }],
    messages: [{
      id: 'm2',
      kind: 'rework',
      authorId: 'you',
      text: '你让这一步重新做了一遍。',
      ts: 2,
      seq: 2,
      meta: { stage: 0, auto: true },
    }],
  }
  const tree = render(StudioTranscript({ room, members, delivery: null }))
  assert.match(text(tree), /你让这一步重新做了一遍/)
  assert.equal(hasClass(tree, 'bt-ububble'), false)
})

test('a studio room shows the pending approval instead of only a badge', async () => {
  const { StudioTranscript } = await load()
  const room = {
    ...finishedRoom(),
    state: 'active',
    stages: [{ ...finishedRoom().stages[0], state: 'active' }],
    approvals: [{
      id: 'a1',
      state: 'pending',
      label: '访问网络',
      summary: 'WebSearch',
      memberName: '研究员',
      scope: { stage: 0, floor: -1, assignment: null },
    }],
  }
  const tree = render(StudioTranscript({ room, members, delivery: null, onApproval: () => {} }))
  assert.equal(hasClass(tree, 'crew-approval'), true)
  assert.match(text(tree), /可以做/)
  assert.match(text(tree), /访问网络/)
})

test('handoffs stay in the room as the sender speaking', async () => {
  const { StudioTranscript } = await load()
  const room = {
    ...finishedRoom(),
    state: 'active',
    stages: [{ ...finishedRoom().stages[0], state: 'active' }],
    messages: [
      { kind: 'system', id: 'h1', authorId: 'lead', text: '@执行官 第 1 步「姓名缩写」交给你。', ts: 1, seq: 1, meta: { kind: 'handoff', stage: 0, from: 'lead', to: ['worker'], authorKind: 'system' } },
      { kind: 'handoff', id: 'h2', authorId: 'verifier', text: '@执行官 验收退回，按上面的意见重做。', ts: 2, seq: 2, meta: { stage: 0, status: 'sent' } },
    ],
  }
  const roster = [
    { id: 'lead', name: '规划师', role: 'lead', roleKind: 'planner' },
    { id: 'worker', name: '执行官', role: 'worker', roleKind: 'executor' },
    { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier' },
  ]
  const tree = render(StudioTranscript({ room, members: roster, delivery: null }))
  // 规划师派活、验收员退回，各按说话的人出现一条；不再折成“系统”过程行。
  assert.equal(hasClass(tree, 'crew-process-line'), false)
  assert.equal(countClass(tree, 'crew-msg-wrap'), 2)
  assert.match(text(tree), /规划师/)
  assert.match(text(tree), /验收员/)
})
