import { execFileSync } from 'node:child_process'
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
  '思想.md': read('思想.md'),
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

// 结构：根目录只放入口、通用思想、产品规则、agent 契约和取舍来源；docs 只放细则。
const rootDocs = readdirSync(root).filter(name => name.endsWith('.md')).sort()
must(
  'root keeps README, thought, Lodge, CLAUDE and Jobs source',
  JSON.stringify(rootDocs) === JSON.stringify(['CLAUDE.md', 'Lodge.md', 'README.md', '乔布斯.md', '思想.md']),
)
const docsDir = readdirSync(resolve(root, 'docs')).filter(name => name.endsWith('.md')).sort()
must('docs keeps architecture, design, agent design and operations', JSON.stringify(docsDir) === JSON.stringify(['agent-design.md', 'architecture.md', 'design.md', 'operations.md']))

for (const [file, text] of Object.entries(docs)) {
  if (file === 'README.md') continue
  must(`${file} says what it answers`, text.includes('本文回答'))
}

// README 是唯一入口：通用思想、产品规则和四份细则都能从入口点开。
must('README links 思想.md', docs['README.md'].includes('(思想.md)'))
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
must('思想.md keeps the principle ledger', docs['思想.md'].includes('## 原则总表'))
must('思想.md keeps the anti-patterns', docs['思想.md'].includes('### 反模式'))
must('思想.md keeps the judgment kernel', docs['思想.md'].includes('## 判断内核'))
must('思想.md keeps the honesty boundary', docs['思想.md'].includes('## 诚实边界'))
must('思想.md keeps the negative boundary', docs['思想.md'].includes('约束副作用，不约束思考'))
must('思想.md keeps the agent negative list', docs['思想.md'].includes('**不做的（负面清单）：**'))
must('思想.md keeps the agent base', docs['思想.md'].includes('## Agent 系统底座'))
must('思想.md keeps tool as permission', docs['思想.md'].includes('### 工具面就是权限面'))
must('思想.md keeps external content untrusted', docs['思想.md'].includes('### 外部内容不可信'))
must('思想.md keeps context as budget', docs['思想.md'].includes('### 上下文是预算'))
must('思想.md keeps unknown is not allow', docs['思想.md'].includes('**未知不等于允许。**'))
must('思想.md keeps supervision as control plane', docs['思想.md'].includes('监督只决定是否继续或停止'))
must('Lodge.md keeps the product north star', docs['Lodge.md'].includes('## 产品北极星'))
must('Lodge.md keeps the honesty boundary', docs['Lodge.md'].includes('## 诚实边界'))
must('Lodge.md keeps the improvement order', docs['Lodge.md'].includes('怎么让它更聪明'))
must('architecture keeps assignment', docs['docs/architecture.md'].includes('## Assignment'))
must('architecture keeps boundary tests', docs['docs/architecture.md'].includes('## 边界靠测试固定'))
must('design keeps principles', docs['docs/design.md'].includes('## 原则'))
must('design keeps the type scale', docs['docs/design.md'].includes('## 字号'))
must('operations keeps room memory', docs['docs/operations.md'].includes('## 房间记忆'))
must('operations keeps the eval ruler', docs['docs/operations.md'].includes('## 评测'))

// 产品判断是独立人格，不靠回答格式：保留判断权和反对权，不锁模板。
const textOf = { ...docs, ...judgmentDocs }
for (const [file, label, snippet] of [
  ['CLAUDE.md', 'an independent judge, not a closing label', '由一套独立的乔布斯式人格来判断，不是回答末尾的装饰'],
  ['CLAUDE.md', 'the right to disagree', '它可以反对你'],
  ['CLAUDE.md', 'no persona label at the end', '不写「乔布斯视角」这类空标签'],
  ['思想.md', 'four questions and two rules', '## 判断内核'],
  ['思想.md', 'the right to refuse the user', '有权反对用户'],
  ['思想.md', 'not a yes-man', '不当应声虫'],
  ['思想.md', 'taste is tradeoffs, not style', '乔布斯的标准是取舍，不是风格'],
]) must(`${file} keeps ${label}`, textOf[file].includes(snippet))

// 原则只有一处索引：领域文档指向总表，不各自另立一套。
for (const file of ['docs/architecture.md', 'docs/design.md', 'docs/operations.md']) {
  must(`${file} points at the principle ledger`, docs[file].includes('思想.md#原则总表'))
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

// 这些文档不进公开仓库：运行现场、内部草稿和个人策略只留本地。
// 只看 tracked + untracked-not-ignored；.data/ 这类已忽略的本地副本不误伤。
const FORBIDDEN_DOCS = [
  [/^docs\/testing\/validation.*\.md$/i, '真实运行记录只留本地'],
  [/^docs\/testing\/.*\/runs\//, '运行现场只留本地'],
  [/^docs\/.*dogfood.*\.md$/i, 'dogfood 记录只留本地'],
  [/^docs\/.*-log\.md$/i, '运行日志只留本地'],
  [/(^|\/)[^/]*-PLAN\.md$/i, '内部计划只留本地'],
  [/(^|\/)PLAN\.md$/i, '内部计划只留本地'],
  [/(^|\/)(NOTES|TODO|SCRATCH)\.md$/i, '内部草稿只留本地'],
  [/(^|\/)draft.*\.md$/i, '草稿只留本地'],
  [/\.local\.md$/i, '本地笔记只留本地'],
  [/^(notes|private|drafts|strategy)\//, '个人笔记只留本地'],
  [/(^|\/)(transcripts|traces|diagnostics|exports)\//, '会话与诊断产物只留本地'],
  [/(^|\/)(roadmap|pricing|customers)\.md$/i, '商业策略只留本地'],
]

let repoFiles = []
let trackedFiles = new Set()
try {
  repoFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
  trackedFiles = new Set(execFileSync('git', ['ls-files', '-z', '--cached'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean))
} catch (error) {
  console.error(`FAIL git file list unavailable: ${error.message}`)
  failures += 1
}

for (const file of repoFiles) {
  const hit = FORBIDDEN_DOCS.find(([pattern]) => pattern.test(file))
  if (hit === undefined) continue
  if (!existsSync(resolve(root, file))) {
    // 工作树删了但索引里还在：提交时会把禁入文件带回来。
    if (trackedFiles.has(file)) {
      console.error(`FAIL ${file} is still tracked; stage its deletion (${hit[1]})`)
      failures += 1
    }
    continue
  }
  console.error(`FAIL ${file} stays out of the repo (${hit[1]})`)
  failures += 1
}

if (failures > 0) process.exit(1)
console.log(`docs: ok (${Object.keys(docs).length} files + judgment)`)
