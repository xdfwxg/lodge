import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const load = async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./stage-confirm.js', import.meta.url))],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    external: ['react'],
  })
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
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

const confirmRoom = over => ({
  state: 'active',
  stages: [{ title: '确认方向', state: 'active' }],
  needsYou: { kind: 'confirm', stage: 0, label: '待确认' },
  ...over,
})

test('a bare confirmation gets one real button', async () => {
  const { StageConfirmCard } = await load()
  const calls = []
  const tree = StageConfirmCard({
    room: confirmRoom(),
    onAccept: stage => { calls.push(stage); return { ok: true } },
  })
  assert.equal(tree.type.name, 'DecisionCard')
  assert.equal(tree.props.kicker, '待你确认 · 第 1 步')
  assert.equal(tree.props.title, '确认方向')
  await tree.props.footer.props.onClick()
  assert.deepEqual(calls, [0])
})

test('progress states and missing handlers render no card', async () => {
  const { StageConfirmCard } = await load()
  assert.equal(StageConfirmCard({ room: confirmRoom({ needsYou: { kind: 'signoff', actionable: false } }), onAccept: () => {} }), null)
  assert.equal(StageConfirmCard({ room: confirmRoom(), onAccept: null }), null)
})
