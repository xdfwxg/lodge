import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const load = async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./home.js', import.meta.url))],
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
  }
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: name => (name === 'react' ? react : (() => { throw new Error(`no platform module ${name}`) })()),
  })
  return module.exports
}

const text = node => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  if (typeof node.type === 'function') return text(node.type(node.props))
  return (node.children ?? []).map(text).join('')
}

test('the front door asks for a goal and offers the sample', async () => {
  const { HomeView } = await load()
  const tree = HomeView({ onSubmit: () => {}, onSample: () => {} })
  const body = text(tree)
  assert.match(body, /今天想完成什么/)
  assert.match(body, /开始/)
  assert.match(body, /先看看一间做完的示例/)
  assert.match(body, /说清要的结果/)
})

test('the front door keeps chat and adjustment as secondary doors', async () => {
  const { HomeView } = await load()
  const body = text(HomeView({
    onSubmit: () => {},
    onSample: () => {},
    onDiscuss: () => {},
    onAdjust: () => {},
  }))
  assert.match(body, /先聊清楚/)
  assert.match(body, /更多选项/)
})

test('a failed start says why it could not begin', async () => {
  const { HomeView } = await load()
  const body = text(HomeView({ onSubmit: () => {}, onSample: () => {}, error: '还没有能开工的模型' }))
  assert.match(body, /还没有能开工的模型/)
})
