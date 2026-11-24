import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = file => readFileSync(resolve(root, file), 'utf8')

let failures = 0
const must = (label, condition) => {
  if (condition) return
  console.error(`FAIL ${label}`)
  failures += 1
}

const docs = {
  'README.md': read('README.md'),
  'Lodge.md': read('Lodge.md'),
  'docs/architecture.md': read('docs/architecture.md'),
  'docs/design.md': read('docs/design.md'),
  'docs/agent-design.md': read('docs/agent-design.md'),
  'docs/operations.md': read('docs/operations.md'),
}

const judgmentDocs = {
  'CLAUDE.md': read('CLAUDE.md'),
  '乔布斯.md': read('乔布斯.md'),
}

// 结构：根目录只放入口、产品契约、agent 契约和取舍标准；docs 只放细则。
const rootDocs = readdirSync(root).filter(name => name.endsWith('.md')).sort()
must(
  'root keeps README, Lodge, CLAUDE and Jobs standards',
  JSON.stringify(rootDocs) === JSON.stringify(['CLAUDE.md', 'Lodge.md', 'README.md', '乔布斯.md']),
)
const docsDir = readdirSync(resolve(root, 'docs')).filter(name => name.endsWith('.md')).sort()
must('docs keeps architecture, design, agent design and operations', JSON.stringify(docsDir) === JSON.stringify(['agent-design.md', 'architecture.md', 'design.md', 'operations.md']))

for (const [file, text] of Object.entries(docs)) {
  if (file === 'README.md') continue
  must(`${file} says what it answers`, text.includes('本文回答'))
}

// README 是唯一入口：四份文档都能从入口点开。
must('README links Lodge.md', docs['README.md'].includes('(Lodge.md)'))
for (const file of ['architecture', 'design', 'agent-design', 'operations']) {
  must(`README links docs/${file}.md`, docs['README.md'].includes(`(docs/${file}.md)`))
}

// 文档互链必须落到真实文件。
for (const [file, text] of Object.entries({ ...docs, ...judgmentDocs })) {
  const dir = dirname(resolve(root, file))
  for (const match of text.matchAll(/\]\((?!https?:|#)([^)\s]+)\)/g)) {
    const target = match[1].split('#')[0]
    if (target === '') continue
    must(`${file} link ${target} resolves`, existsSync(resolve(dir, target)))
  }
}

// 每份文档保留自己的骨架；改版可以换句子，不能悄悄换职责。
must('Lodge.md keeps the product north star', docs['Lodge.md'].includes('## 产品北极星'))
must('Lodge.md keeps the principle ledger', docs['Lodge.md'].includes('## 原则总表'))
must('Lodge.md keeps the anti-patterns', docs['Lodge.md'].includes('### 反模式'))
must('Lodge.md keeps the honesty boundary', docs['Lodge.md'].includes('## 诚实边界'))
must('Lodge.md keeps the improvement order', docs['Lodge.md'].includes('怎么让它更聪明'))
must('architecture keeps assignment', docs['docs/architecture.md'].includes('## Assignment'))
must('architecture keeps boundary tests', docs['docs/architecture.md'].includes('## 边界靠测试固定'))
must('design keeps principles', docs['docs/design.md'].includes('## 原则'))
must('design keeps the type scale', docs['docs/design.md'].includes('## 字号'))
must('operations keeps room memory', docs['docs/operations.md'].includes('## 房间记忆'))
must('operations keeps the eval ruler', docs['docs/operations.md'].includes('## 评测'))

// 产品判断是独立人格，不是回答末尾的标签：措辞可以改，判断权和三段收尾不能丢。
for (const [file, label, snippet] of [
  ['CLAUDE.md', 'an independent judge, not a closing label', '由一套独立的乔布斯式人格来判断，不是回答末尾的装饰'],
  ['CLAUDE.md', 'the right to disagree', '它可以反对你'],
  ['CLAUDE.md', 'the label line', '**标签**'],
  ['CLAUDE.md', 'the reason line', '**理由**'],
  ['CLAUDE.md', 'the closing line', '**收尾**'],
  ['CLAUDE.md', 'no persona label at the end', '不写「乔布斯视角」这类空标签'],
  ['乔布斯.md', 'four questions and two rules', '## 六、判断内核：四问两则'],
  ['乔布斯.md', 'the right to refuse the user', '有权反对用户'],
  ['乔布斯.md', 'not a yes-man', '不当应声虫'],
  ['乔布斯.md', 'taste is tradeoffs, not style', '乔布斯的标准是取舍，不是风格'],
]) must(`${file} keeps ${label}`, judgmentDocs[file].includes(snippet))

// 原则只有一处索引：领域文档指向总表，不各自另立一套。
for (const file of ['docs/architecture.md', 'docs/design.md', 'docs/operations.md']) {
  must(`${file} points at the principle ledger`, docs[file].includes('Lodge.md#原则总表'))
}

for (const file of [
  '架构升级.md',
  '设计语言.md',
  '理念升级.md',
  '设计思想.md',
  '架构.md',
  '重构.md',
  '新方案.md',
  '漫漫人生路.md',
  'token上下文.md',
  'docs/lodge-design.md',
  'docs/architecture-layers.md',
  'docs/reuse-map.md',
  'docs/python-fastapi-feasibility.md',
  'docs/macos-desktop.md',
  'docs/runtimes.md',
  'docs/project-room.md',
]) {
  must(`${file} stays merged or deleted`, !existsSync(resolve(root, file)))
}

const stale = /(?:理念升级|设计语言\.md|架构升级\.md|设计思想\.md|docs\/lodge-design|lodge-design\.md|reuse-map)/
for (const [file, text] of Object.entries(docs)) {
  must(`${file} does not point at retired docs`, !stale.test(text))
}

if (failures > 0) process.exit(1)
console.log(`docs: ok (${Object.keys(docs).length} files + judgment)`)
