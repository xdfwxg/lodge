import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const load = async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./stop-reply.js', import.meta.url))],
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
    useEffect: () => {},
    useRef: () => ({ current: null }),
  }
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: name => {
      if (name === 'react') return react
      throw new Error(`no platform module ${name}`)
    },
    document: { body: {} },
  })
  return module.exports
}

const render = node => {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (typeof node.type === 'function') return render(node.type(node.props))
  return { ...node, children: (node.children ?? []).map(render) }
}

const room = (overrides = {}) => ({
  state: 'active',
  live: true,
  busyMembers: ['executor'],
  turnQueue: [],
  messages: [],
  ...overrides,
})

test('a quiet room has no stop control', async () => {
  const { StopReply } = await load()
  assert.equal(StopReply({ room: room({ busyMembers: [] }), onInterrupt: () => {} }), null)
})

test('a running turn shows one stop square in the send position', async () => {
  const { StopReply } = await load()
  const button = render(StopReply({ room: room(), onInterrupt: () => {} }))
  assert.equal(button.props.className, 'crew-send')
  assert.equal(button.props['aria-label'], '停止回复')
  assert.equal(button.props['data-stop'], 'true')
})

test('the stop square interrupts immediately, without a confirmation step', async () => {
  const { StopReply } = await load()
  let interrupted = 0
  const tree = render(StopReply({
    room: room(),
    onInterrupt: async () => {
      interrupted += 1
      return { ok: true }
    },
  }))
  tree.props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(interrupted, 1)
})

test('a running chat round or a thinking host can be stopped from the composer', async () => {
  const { turnRunning } = await load()
  assert.equal(turnRunning({ state: 'active', live: true, chat: { running: true } }), true)
  assert.equal(turnRunning({ state: 'active', live: true, chat: { running: false, hostThinking: true } }), true)
  assert.equal(turnRunning({ state: 'active', live: true, chat: { running: false, hostThinking: false } }), false)
})

test('a finished turn hides the stop square even when activity is still recent', async () => {
  const { turnRunning } = await load()
  const record = room({
    busyMembers: [],
    turnQueue: [],
    assignments: [{ status: 'reported', toMemberId: 'executor' }],
    messages: [{ kind: 'activity', authorId: 'executor', ts: Date.now() }],
  })
  assert.equal(turnRunning(record), false)
})

test('an open handoff keeps the stop square even when the base reports nobody working', async () => {
  const { turnRunning } = await load()
  assert.equal(turnRunning(room({ busyMembers: [], assignments: [{ status: 'working', toMemberId: 'executor' }] })), true)
  assert.equal(turnRunning(room({ busyMembers: [], assignments: [{ status: 'sent', toMemberId: 'executor' }] })), true)
})
