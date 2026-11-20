import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const load = async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./stop-room.js', import.meta.url))],
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
const text = node => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  return (node.children ?? []).map(text).join('')
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
  const { StopRoom } = await load()
  assert.equal(StopRoom({ room: room({ busyMembers: [] }), onStop: () => {} }), null)
})

test('a running room shows one quiet stop entry', async () => {
  const { StopRoom } = await load()
  const tree = render(StopRoom({ room: room(), onStop: () => {} }))
  assert.equal(text(tree), '停下')
})

test('the composer variant is the send button, showing a stop square', async () => {
  const { StopRoom } = await load()
  const tree = render(StopRoom({ room: room(), onStop: () => {}, variant: 'composer' }))
  const button = tree.children[0]
  assert.equal(button.props.className, 'crew-send crew-stop-send')
  assert.equal(button.props['aria-label'], '停下这一轮')
  assert.equal(button.props['data-stop'], 'true')
})

test('a running chat round or a thinking host can be stopped from the composer', async () => {
  const { roomRunning } = await load()
  assert.equal(roomRunning({ state: 'active', live: true, chat: { running: true } }, []), true)
  assert.equal(roomRunning({ state: 'active', live: true, chat: { running: false, hostThinking: true } }, []), true)
  assert.equal(roomRunning({ state: 'active', live: true, chat: { running: false, hostThinking: false } }, []), false)
})
