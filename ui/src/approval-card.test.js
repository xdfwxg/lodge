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

test('an external approval offers allow once or deny, with no room-wide switch', async () => {
  const { ApprovalCard } = await load()
  const calls = []
  const tree = render(ApprovalCard({
    approval: {
      memberName: '研究员',
      label: '访问公开网页',
      kind: 'network',
      target: 'example.com',
      summary: 'mcp__chrome-devtools__navigate_page',
      gate: { decision: 'allow', reasons: [] },
    },
    onDecide: decision => calls.push(decision),
  }))
  assert.match(text(tree), /研究员想访问公开网页/)
  assert.match(text(tree), /example.com/)
  assert.match(text(tree), /会访问外部服务/)
  assert.doesNotMatch(text(tree), /要你确认/)
  assert.deepEqual(buttons(tree).map(button => text(button)), ['先别做', '可以做'])
  buttons(tree)[0].props.onClick()
  buttons(tree)[1].props.onClick()
  assert.deepEqual(calls, ['deny', 'allow'])
})

test('the approval card leads with the target, hides the command, and keeps one doubt', async () => {
  const { ApprovalCard } = await load()
  const calls = []
  const tree = render(ApprovalCard({
    approval: {
      memberName: '执行官',
      label: '推送到远端',
      kind: 'push',
      target: 'main',
      summary: 'git push origin main',
      command: 'git push origin main --force',
      gate: { decision: 'review', reasons: ['发布或推送远端'] },
    },
    onDecide: decision => calls.push(decision),
  }))
  assert.match(text(tree), /执行官想推送到远端/)
  assert.match(text(tree), /main/)
  assert.match(text(tree), /会改远端仓库/)
  assert.match(text(tree), /我没把握/)
  assert.match(text(tree), /看命令/)
  assert.match(text(tree), /--force/)
  assert.deepEqual(buttons(tree).map(button => text(button)), ['先别做', '可以做'])
  buttons(tree)[0].props.onClick()
  buttons(tree)[1].props.onClick()
  assert.deepEqual(calls, ['deny', 'allow'])
})
