import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const load = async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./delivery-sheet.js', import.meta.url))],
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

test('the delivery sheet shows goal, commit, stage commands, verdicts and files', async () => {
  const { DeliverySheet } = await load()
  const tree = render(DeliverySheet({
    delivery: {
      name: '设置页保存',
      goal: '保存后刷新仍生效',
      completedAt: Date.UTC(2026, 10, 12, 4, 0),
      commit: 'abcdef1234567890',
      independenceLabel: '同引擎 · 独立性降级',
      seatNames: { v1: '复核一', v2: '复核二' },
      workspace: { vcs: 'git' },
      stages: [
        {
          index: 0,
          title: '对齐',
          kind: 'decision',
          state: 'passed',
          acceptance: null,
          commands: [],
          verdicts: [],
          changedFiles: [],
        },
        {
          index: 1,
          title: '实现',
          kind: 'deliverable',
          state: 'passed',
          acceptance: 'npm test',
          commands: [{ id: 'e1', command: 'npm test', exit: 0, changedFiles: ['src/a.js'] }],
          verdicts: [{ id: 'v1', authorId: 'v1', pass: true }, { id: 'v2', authorId: 'v2', pass: true }],
          changedFiles: ['src/a.js'],
        },
      ],
      commands: [{ id: 'e1', command: 'npm test', exit: 0 }],
      changedFiles: ['src/a.js'],
    },
  }))
  assert.match(text(tree), /交付单/)
  assert.match(text(tree), /保存后刷新仍生效/)
  assert.match(text(tree), /abcdef123456/)
  assert.match(text(tree), /npm test · exit 0/)
  assert.match(text(tree), /复核一/)
  assert.match(text(tree), /复核二/)
  assert.match(text(tree), /src\/a\.js/)
  assert.match(text(tree), /2\/2 阶段/)
  assert.match(text(tree), /1\/1 命令通过/)
})
