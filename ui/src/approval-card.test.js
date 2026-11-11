import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// Same fake-React harness as the goal island tests; no browser or DOM needed.
const load = async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./approval-card.js', import.meta.url))],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    external: ['react'],
  })
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment',
  }
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: name => (name === 'react' ? react : (() => { throw new Error(`no platform module ${name}`) })()),
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
const buttons = node => {
  if (node === null || node === undefined || typeof node !== 'object') return []
  const found = node.type === 'button' ? [node] : []
  return found.concat((node.children ?? []).flatMap(buttons))
}

test('the approval card shows the seat and external command with only two decisions', async () => {
  const { ApprovalCard } = await load()
  const calls = []
  const tree = render(ApprovalCard({
    approval: { seatName: '执行', label: '推送到远端', summary: 'git push origin main' },
    onDecide: decision => calls.push(decision),
  }))
  assert.match(text(tree), /外部动作等你批准/)
  assert.match(text(tree), /执行/)
  assert.match(text(tree), /git push origin main/)
  assert.deepEqual(buttons(tree).map(button => text(button)), ['拒绝', '允许'])
  buttons(tree)[0].props.onClick()
  buttons(tree)[1].props.onClick()
  assert.deepEqual(calls, ['deny', 'allow'])
})
