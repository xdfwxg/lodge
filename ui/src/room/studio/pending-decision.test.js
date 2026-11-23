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
  members: [
    { id: 'planner', name: '规划师', role: 'lead' },
    { id: 'executor', name: '执行官', role: 'worker' },
  ],
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
  assert.match(tree.props.kicker, /想请你定/)
  // 提问的人是规划师本人，卡头显示头像和名字。
  assert.equal(tree.props.speaker?.name, '规划师')
  const options = tree.children.find(child => child?.props?.className === 'crew-decision-options')
  // 卡上的路之外总有一行「其他」，选中后输入框就长在这一行里。
  assert.equal(options.children.length, 3)
  assert.equal(options.children[0].props.badge, '推荐')
  const other = options.children[2]
  assert.match(other.props.className, /crew-decision-other/)
  assert.equal(other.props['aria-checked'], false)
  assert.equal(other.children[1].children[0].children[0], '其他')
  const accept = tree.props.footer.children.find(child => /crew-accept/.test(child.props.className))
  await accept.props.onClick()
  assert.deepEqual(calls, [['d1', 'keep-local']])
})

test('the card drops the restatement and the button says when it will send the recommendation', async () => {
  const { PendingDecisionCard } = await load()
  const tree = PendingDecisionCard({ room: room(), onAnswer: () => ({ ok: true }) })
  // 选项和推荐标签已经说明白了，不再用一句话复述。
  assert.equal(tree.props.lead ?? '', '')
  const [cancel, accept] = tree.props.footer.children
  assert.equal(cancel.children[0], '先不做这一步')
  assert.equal(cancel.props.className, 'crew-ghost')
  assert.equal(accept.children[0], '按推荐继续')
})

test('no open decision renders no card', async () => {
  const { PendingDecisionCard } = await load()
  assert.equal(PendingDecisionCard({ room: { pendingDecision: null }, onAnswer: () => {} }), null)
  assert.equal(PendingDecisionCard({ room: room(), onAnswer: null }), null)
})
