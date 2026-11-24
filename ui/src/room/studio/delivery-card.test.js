import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const nodeRequire = createRequire(import.meta.url)

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
    useMemo: factory => factory(),
    useEffect: () => {},
    useRef: () => ({ current: null }),
  }
  const jsx = (type, props) => ({
    type,
    props: props ?? {},
    children: [].concat(props?.children ?? []).flat(Infinity),
  })
  const jsxRuntime = { Fragment: 'fragment', jsx, jsxs: jsx, jsxDEV: jsx }
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: name => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return jsxRuntime
      if (name.startsWith('node:')) return nodeRequire(name)
      throw new Error(`no platform module ${name}`)
    },
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
const find = (node, match) => {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (match(node)) return node
  for (const child of node.children ?? []) {
    const found = find(child, match)
    if (found !== null) return found
  }
  return null
}

test('the delivery sheet shows goal, stages, verdicts and files', async () => {
  const { DeliveryCard } = await load()
  const tree = render(DeliveryCard({
    delivery: {
      name: '设置页保存',
      goal: '保存后刷新仍生效',
      workspacePath: '/tmp/room',
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
          results: [],
          verdicts: [],
          changedFiles: [],
        },
        {
          index: 1,
          title: '实现',
          kind: 'deliverable',
          state: 'passed',
          deliverable: '保存后刷新仍生效',
          results: [{ id: 'e1', changedFiles: ['src/a.js'] }],
          verdicts: [{ id: 'v1', authorId: 'v1', pass: true }, { id: 'v2', authorId: 'v2', pass: true }],
          changedFiles: ['src/a.js'],
        },
      ],
      changedFiles: ['src/a.js'],
    },
  }))
  assert.match(text(tree), /结果/)
  assert.match(text(tree), /保存后刷新仍生效/)
  // 版本号是内核记账，留在可下载的交付记录里，不进结果卡详情。
  assert.doesNotMatch(text(tree), /abcdef123456/)
  assert.match(text(tree), /复核一/)
  assert.match(text(tree), /复核二/)
  assert.match(text(tree), /src\/a\.js/)
  assert.doesNotMatch(text(tree), /2 步/)
  assert.match(text(tree), /2 位验收通过/)
  assert.match(text(tree), /在文件夹打开/)
})

test('a verified result shows the verdict, not a waiting notice', async () => {
  const { DeliveryCard } = await load()
  const tree = render(DeliveryCard({
    delivery: {
      name: '零准备',
      goal: '写一个 hello.txt',
      stages: [{
        index: 1,
        title: '写文件',
        kind: 'deliverable',
        deliverable: 'hello.txt',
        results: [{ id: 'e1', changedFiles: ['hello.txt'] }],
        verdicts: [{ id: 'v1', authorId: 'v1', pass: true, text: 'hello.txt 内容正确' }],
        changedFiles: ['hello.txt'],
      }],
      changedFiles: ['hello.txt'],
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
      artifacts: [{ path: '/tmp/room/src/a.js', relativePath: 'src/a.js' }],
      changedFiles: ['src/a.js'],
    },
  }))
  assert.match(text(tree), /1 个文件/)
  assert.doesNotMatch(text(tree), /其他改动/)
  assert.doesNotMatch(text(tree), /改动文件/)
})

test('a sample artifact opens its content in the card instead of the filesystem', async () => {
  const { DeliveryCard } = await load()
  const tree = render(DeliveryCard({
    delivery: {
      name: '发布前检查清单',
      sample: true,
      stages: [],
      artifacts: [{ path: 'RELEASE_CHECKLIST.md', content: '- [ ] 检查' }],
    },
  }))
  assert.match(text(tree), /查看/)
  assert.match(text(tree), /- \[ \] 检查/)
  assert.doesNotMatch(text(tree), /打开/)
})

test('a Markdown result is typeset, a plain result keeps its lines', async () => {
  const { DeliveryPreview } = await load()
  const document = render(DeliveryPreview({ kind: 'document', content: '# 报告', image: null, alt: 'report.md' }))
  assert.notEqual(find(document, node => String(node.props?.className ?? '').includes('md_markdown')), null)
  assert.equal(find(document, node => node.type === 'pre'), null)
  const preview = find(document, node => node.props?.className === 'studio-delivery-preview')
  assert.equal(preview.props.tabIndex, 0)
  assert.equal(preview.props.role, 'region')
  assert.match(preview.props['aria-label'], /交付结果预览/)
  const plain = render(DeliveryPreview({ kind: 'text', content: 'line one\nline two', image: null, alt: 'notes.txt' }))
  assert.equal(text(find(plain, node => node.type === 'pre')), 'line one\nline two')
})

test('an image result shows the image itself', async () => {
  const { DeliveryPreview } = await load()
  const tree = render(DeliveryPreview({
    kind: 'image',
    content: '',
    image: 'data:image/png;base64,AAAA',
    alt: 'shot.png',
  }))
  const image = find(tree, node => node.type === 'img')
  assert.equal(image.props.src, 'data:image/png;base64,AAAA')
  assert.equal(image.props.alt, 'shot.png')
})

test('a readable result wins over a file that cannot be previewed', async () => {
  const { DeliveryCard } = await load()
  const tree = render(DeliveryCard({
    delivery: {
      name: '检查报告',
      stages: [],
      artifacts: [
        { path: 'guide.pdf', kind: 'file' },
        { path: 'report.md', kind: 'document', content: '# 结果正文' },
      ],
      changedFiles: [],
    },
  }))
  const preview = find(tree, node => node.props?.className === 'studio-delivery-preview')
  assert.notEqual(find(preview, node => String(node.props?.className ?? '').includes('md_markdown')), null)
  assert.equal(find(tree, node => node.props?.className === 'studio-delivery-file'), null)
})
