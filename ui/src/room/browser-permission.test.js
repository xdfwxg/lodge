import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const load = async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./browser-permission.js', import.meta.url))],
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
const room = (access, withBrowser = true) => ({
  roomAccess: access,
  members: withBrowser
    ? [{ id: 'worker', role: 'worker', body: { spec: { mcp: [{ server: 'chrome-devtools', scopes: ['read'], approval: 'ask' }] } } }]
    : [{ id: 'worker', role: 'worker', body: { spec: { mcp: [] } } }],
})

test('a room without browser capability has no permission control', async () => {
  const { BrowserPermission } = await load()
  assert.equal(BrowserPermission({ room: room('ask', false) }), null)
})

test('a regular room shows no permission entry', async () => {
  const { BrowserPermission } = await load()
  assert.equal(BrowserPermission({ room: room('ask') }), null)
})

test('a full room shows one quiet status entry', async () => {
  const { BrowserPermission } = await load()
  const tree = render(BrowserPermission({ room: room('allow') }))
  assert.equal(text(tree), '免确认')
})
