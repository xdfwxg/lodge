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

test('a finished room shows the result, not the process', async () => {
  const { StudioTranscript } = await load()
  const room = finishedRoom()
  const tree = render(StudioTranscript({ room, members, delivery }))
  assert.match(text(tree), /设置页保存/)
  assert.match(text(tree), /工作记录/)
  assert.equal(hasClass(tree, 'studio-process'), true)
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
