// 独立尺子：按目标原文验收，不依赖仓库里那份很弱的测试。
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const repo = process.argv[2]
const report = { pass: false, detail: '', facts: {} }

const cases = [
  { input: 'Hello World', expected: 'hello-world' },
  { input: 'Hello  World', expected: 'hello-world' },
  { input: '你好，世界', expected: '你好世界' },
  { input: 'a--b', expected: 'a-b' },
  { input: 'A_B!', expected: 'ab' },
  { input: '  Trim  Me  ', expected: 'trim-me' },
]

try {
  const module = await import(pathToFileURL(join(repo, 'src', 'slug.js')).href)
  if (typeof module.slugify !== 'function') throw new Error('没有导出 slugify')
  const results = cases.map(item => {
    let actual
    try {
      actual = module.slugify(item.input)
    } catch (error) {
      actual = `抛出错误：${error?.message ?? error}`
    }
    return { ...item, actual, ok: actual === item.expected }
  })
  report.facts = { results }
  const misses = results.filter(item => !item.ok)
  if (misses.length === 0) {
    report.pass = true
    report.detail = `${results.length} 条目标规则全过`
  } else {
    report.detail = misses.map(item => `${JSON.stringify(item.input)} → ${JSON.stringify(item.actual)}（应为 ${JSON.stringify(item.expected)}）`).join('；')
  }
} catch (error) {
  report.detail = String(error?.message ?? error)
}

console.log(JSON.stringify(report))
process.exit(report.pass ? 0 : 1)
