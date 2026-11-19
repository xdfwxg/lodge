import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const load = async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./human-gate.js', import.meta.url))],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    external: ['react'],
  })
  const react = {
    createElement: () => null,
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
  state: 'active',
  stages: [{ title: '查机票', state: 'active' }],
  lastPlannerDecision: {
    stage: 0,
    kind: 'human',
    verdictId: 'v1',
    judgment: {
      reason: '没有能过验证的查询通道。',
      actionRequired: '需要用户拍板二选一：A. 接受当前版本作为交付，文件里写清最低价未证实；B. 提供查询通道，再补齐报价。',
    },
  },
  messages: [{ id: 'v1', kind: 'verdict', seq: 1, meta: { stage: 0, pass: false } }],
})

test('a human handoff turns A/B into one-tap choices', async () => {
  const { humanGateOf } = await load()
  const gate = humanGateOf(room())
  assert.equal(gate.options.length, 2)
  assert.equal(gate.options[0].id, 'A')
  assert.equal(gate.options[0].action, 'accept')
  assert.match(gate.options[0].title, /接受/)
  assert.equal(gate.options[1].id, 'B')
  assert.equal(gate.options[1].action, 'rework')
})
