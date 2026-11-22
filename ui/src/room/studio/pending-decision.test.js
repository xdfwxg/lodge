import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const load = async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./pending-decision.js', import.meta.url))],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    external: ['react'],
  })
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment',
    useState: initial => [initial, () => {}],
  }
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: name => {
      if (name === 'react') return react
      throw new Error(`no platform module ${name}`)
    },
  })
  return module.exports
}

const room = () => ({
  pendingDecision: {
    id: 'd1',
    status: 'open',
    stage: 0,
    question: '走哪条路？',
    options: [
      { id: 'keep-local', title: '保留本地', effect: '不覆盖刚改的内容' },
      { id: 'take-remote', title: '用远端', effect: '当前页回到远端版本' },
    ],
    recommended: 'keep-local',
  },
})

test('the pending decision is one card with options and a recommended path', async () => {
  const { PendingDecisionCard } = await load()
  const calls = []
  const tree = PendingDecisionCard({ room: room(), onAnswer: (id, optionId) => { calls.push([id, optionId]); return { ok: true } } })
  assert.equal(tree.type.name, 'DecisionCard')
  assert.equal(tree.props.title, '走哪条路？')
  assert.match(tree.props.kicker, /规划师想请你定/)
  const options = tree.children.find(child => child?.props?.className === 'crew-decision-options')
  assert.equal(options.children.length, 2)
  assert.equal(options.children[0].props.badge, '推荐')
  await tree.props.footer.children[0].props.onClick()
  assert.deepEqual(calls, [['d1', 'keep-local']])
})

test('no open decision renders no card', async () => {
  const { PendingDecisionCard } = await load()
  assert.equal(PendingDecisionCard({ room: { pendingDecision: null }, onAnswer: () => {} }), null)
  assert.equal(PendingDecisionCard({ room: room(), onAnswer: null }), null)
})
