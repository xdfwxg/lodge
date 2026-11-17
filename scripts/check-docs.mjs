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

const lodge = read('Lodge.md')
const architecture = read('架构升级.md')
const style = read('设计语言.md')
const feedback = read('README.md')
const operations = read('docs/operations.md')

must('Lodge.md states the room, member and body triad', lodge.includes('房间（Room）是本体') && lodge.includes('Bot 是这个人现在的身体'))
must('Lodge.md states the assignment line', lodge.includes('一条 Assignment 一条记录'))
must('Lodge.md keeps the document rule', lodge.includes('## 文档：少而准'))
must('Lodge.md keeps the shadow review position', lodge.includes('## 影子评审：验收前的第二视角') && lodge.includes('不裁决、不阻塞'))
must('operations keeps shadow review before acceptance', operations.includes('当前阶段验收前') && operations.includes('不接外部服务'))
must('Lodge.md says the product owns the checks', lodge.includes('检查由产品保证') && lodge.includes('没有可自动运行的检查'))
must('架构升级.md explains the layers', architecture.includes('## 分层'))
must('架构升级.md explains assignments', architecture.includes('## Assignment'))
must('架构升级.md keeps the upgrade log', architecture.includes('## 升级记录'))
must('架构升级.md records explicit non-goals', architecture.includes('## 明确不做'))
must('架构升级.md keeps license attribution', architecture.includes('## 许可与归属'))
must('Lodge.md points to the design language', lodge.includes('(设计语言.md)'))
must('Lodge.md keeps the three-doc rule', lodge.includes('只保留三份设计文档'))
must('架构升级.md points to the design language', architecture.includes('设计语言.md'))
must('设计语言.md keeps the type scale', style.includes('## 字号与字重') && style.includes('卡片内正文默认 13 / 20'))
must('设计语言.md keeps motion and states', style.includes('## 动效') && style.includes('## 状态与反馈'))
must('设计语言.md keeps the interaction rules', style.includes('方向键') && style.includes('头像标记为装饰'))
must('设计语言.md keeps the group-chat reading rule', style.includes('像看群聊一样看懂谁在做什么'))
must('Lodge.md keeps the studio reading rule', lodge.includes('像看群聊一样看懂谁在做什么') && lodge.includes('不切章节'))
must('设计语言.md keeps the human error rule', style.includes('原始错误') && style.includes('不写实现旁白'))
must('operations keeps the human error rule', operations.includes('systemNotice') && operations.includes('meta.detail') && operations.includes('humanErrorText'))
must('README links the product story', feedback.includes('(Lodge.md)'))
must('README links the architecture record', feedback.includes('(架构升级.md)'))
must('README links the design language', feedback.includes('(设计语言.md)'))
must('README links the operations manual', feedback.includes('[docs/operations.md](docs/operations.md)'))

must('docs/operations.md stays available', existsSync(resolve(root, 'docs/operations.md')))
for (const file of ['docs/macos-desktop.md', 'docs/runtimes.md']) {
  must(`${file} stays merged`, !existsSync(resolve(root, file)))
}

// 设计文档只留三份；旧文档回流会让文档再次分叉。
const designDocs = readdirSync(root)
  .filter(name => name.endsWith('.md') && name !== 'README.md')
  .sort()
must('only three design docs live at the root', JSON.stringify(designDocs) === JSON.stringify(['Lodge.md', '架构升级.md', '设计语言.md'].sort()))
for (const file of [
  '理念升级.md',
  '设计思想.md',
  '架构.md',
  '重构.md',
  '新方案.md',
  '漫漫人生路.md',
  'token上下文.md',
  'docs/lodge-design.md',
  'docs/architecture.md',
  'docs/architecture-layers.md',
  'docs/reuse-map.md',
  'docs/python-fastapi-feasibility.md',
]) {
  must(`${file} stays deleted`, !existsSync(resolve(root, file)))
}

must('docs do not point at deleted design files', !/(?:理念升级|设计思想\.md|架构\.md|重构\.md|lodge-design|reuse-map)/.test(lodge + architecture + feedback))

if (failures > 0) process.exit(1)
console.log('docs: ok')
