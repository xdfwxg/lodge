import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const load = async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./working-line.js', import.meta.url))],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    external: ['react', 'react/jsx-runtime'],
  })
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'fragment',
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
  }
  const jsx = (type, props) => ({ type, props: props ?? {}, children: [].concat(props?.children ?? []).flat(Infinity) })
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: name => {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { Fragment: 'fragment', jsx, jsxs: jsx, jsxDEV: jsx }
      throw new Error(`no platform module ${name}`)
    },
    Date,
    setInterval: () => 0,
    clearInterval: () => {},
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

test('a running command is one animated line with elapsed time', async () => {
  const { WorkingLine } = await load()
  const tree = render(WorkingLine({
    activity: { ts: Date.now() - 5000, text: 'Bash', meta: { tool: 'Bash' } },
    memberName: '研究员',
  }))
  assert.match(text(tree), /研究员/)
  assert.match(text(tree), /正在运行命令/)
  assert.match(text(tree), /\d+s/)
  assert.match(text(tree), /Bash/)
})

test('browser tools read as page work, not raw MCP names', async () => {
  const { workingActionOf } = await load()
  assert.equal(workingActionOf('mcp__chrome-devtools__navigate_page'), '正在打开网页')
  assert.equal(workingActionOf('mcp__chrome-devtools__take_snapshot'), '正在读取网页')
})
