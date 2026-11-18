import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const load = async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./delivery-card.js', import.meta.url))],
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
  const { DeliveryCard } = await load()
  const tree = render(DeliveryCard({
    delivery: {
      name: '设置页保存',
      goal: '保存后刷新仍生效',
      completedAt: Date.UTC(2026, 10, 12, 4, 0),
      commit: 'abcdef1234567890',
      independenceLabel: '同引擎 · 独立性降级',
      memberNames: { v1: '复核一', v2: '复核二' },
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
  assert.match(text(tree), /结果/)
  assert.match(text(tree), /保存后刷新仍生效/)
  assert.match(text(tree), /abcdef123456/)
  assert.match(text(tree), /npm test · 退出码 0/)
  assert.match(text(tree), /复核一/)
  assert.match(text(tree), /复核二/)
  assert.match(text(tree), /src\/a\.js/)
  assert.match(text(tree), /2 步/)
  assert.match(text(tree), /1 项检查/)
})

test('a verified manual stage shows the verdict, not the waiting notice', async () => {
  const { DeliveryCard } = await load()
  const tree = render(DeliveryCard({
    delivery: {
      name: '零准备',
      goal: '写一个 hello.txt',
      stages: [{
        index: 1,
        title: '写文件',
        kind: 'decision',
        manual: { text: '结果已经好了，等验收员复核。' },
        commands: [],
        verdicts: [{ id: 'v1', authorId: 'v1', pass: true, text: 'hello.txt 内容正确' }],
        changedFiles: [],
      }],
      commands: [],
      changedFiles: [],
    },
  }))
  assert.match(text(tree), /验收：hello\.txt 内容正确/)
  assert.doesNotMatch(text(tree), /等验收员复核/)
})

test('cost reads as a number, a lower bound, or unknown', async () => {
  const { DeliveryCard } = await load()
  const base = { name: '设置页保存', stages: [], commands: [], changedFiles: [] }
  const reported = render(DeliveryCard({
    delivery: { ...base, usage: { costMicroUsd: 4200, costStatus: 'reported' } },
  }))
  assert.match(text(reported), /\$0\.0042/)
  const partial = render(DeliveryCard({
    delivery: { ...base, usage: { costMicroUsd: 4000, costStatus: 'partial' } },
  }))
  assert.match(text(partial), /至少 \$0\.0040/)
  const unknown = render(DeliveryCard({
    delivery: { ...base, usage: { costMicroUsd: 0, costStatus: 'unknown' } },
  }))
  assert.match(text(unknown), /费用未知/)
  assert.doesNotMatch(text(unknown), /\$0\.0000/)
})

test('an artifact and its relative changed path are counted once', async () => {
  const { DeliveryCard } = await load()
  const tree = render(DeliveryCard({
    delivery: {
      name: '设置页保存',
      workspacePath: '/tmp/room',
      stages: [],
      commands: [],
      artifacts: [{ path: '/tmp/room/src/a.js', relativePath: 'src/a.js' }],
      changedFiles: ['src/a.js'],
    },
  }))
  assert.match(text(tree), /1 个文件/)
  assert.doesNotMatch(text(tree), /其他改动/)
  assert.doesNotMatch(text(tree), /改动文件/)
})

test('a failed check reads as failed and a simulated check says so', async () => {
  const { DeliveryCard } = await load()
  const tree = render(DeliveryCard({
    delivery: {
      name: '设置页保存',
      stages: [],
      commands: [
        { id: 'e1', command: 'npm test', exit: 1 },
        { id: 'e2', command: 'npm run lint', exit: 0, simulated: true },
      ],
      changedFiles: [],
    },
  }))
  assert.match(text(tree), /没通过/)
  assert.match(text(tree), /示例运行/)
})

test('a sample artifact opens its content in the card instead of the filesystem', async () => {
  const { DeliveryCard } = await load()
  const tree = render(DeliveryCard({
    delivery: {
      name: '发布前检查清单',
      sample: true,
      stages: [],
      commands: [],
      artifacts: [{ path: 'RELEASE_CHECKLIST.md', content: '- [ ] 检查' }],
    },
  }))
  assert.match(text(tree), /查看/)
  assert.match(text(tree), /- \[ \] 检查/)
  assert.doesNotMatch(text(tree), /打开/)
})

test('the delivery sheet offers a way to continue', async () => {
  const { DeliveryCard } = await load()
  const tree = render(DeliveryCard({
    delivery: {
      name: '设置页保存',
      goal: '保存后刷新仍生效',
      stages: [],
      commands: [],
      changedFiles: [],
    },
    onContinue: () => {},
  }))
  assert.match(text(tree), /继续做/)
})
