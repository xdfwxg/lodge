import { existsSync, readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const design = read('docs/lodge-design.md')
const reuse = read('docs/reuse-map.md')
const thought = read('设计思想.md')

let failures = 0
const must = (label, condition) => {
  if (condition) return
  console.error(`FAIL ${label}`)
  failures += 1
}
const mustNot = (label, pattern, text) => must(label, !pattern.test(text))

must('design has a current-status block', design.includes('当前实现状态'))
must('design names the room path under .crew', design.includes('.crew/rooms/<room-id>/'))
must('design lists GOAL.md', design.includes('GOAL.md'))
must('design lists CONCLUSION.md', design.includes('CONCLUSION.md'))
must('design has the actual engine port', design.includes('P0 实际端口'))
must('design has a current milestone progress note', /当前进度（\d{4}-\d{2}-\d{2}）/.test(design))
must('design does not use the old rooms/ path', !/(?<!\.crew\/)rooms\/<room-id>\//.test(design))
must('design does not use .data/rooms as the current path', !/\.data\/rooms\//.test(design))
must('reuse map has a current-status line', /当前实现（\d{4}-\d{2}-\d{2}）/.test(reuse))
must('reuse map points at the status section', reuse.includes('§8.5'))
must('reuse map keeps known boundaries', reuse.includes('已知边界'))
must('thought doc has the external-claims rule', thought.includes('## 12. 对外表述纪律'))
must('boundary test exists', existsSync(new URL('../server/crew/boundary.test.js', import.meta.url)))
must('schema migration test exists', existsSync(new URL('../server/crew/store.test.js', import.meta.url)))
for (const [file, text] of [['design', design], ['reuse', reuse], ['thought', thought]]) {
  mustNot(`${file} no longer claims a 300-line limit`, /单文件\s*300\s*行上限/, text)
  mustNot(`${file} no longer says "only CSS is copied"`, /只抄\s*CSS/, text)
  mustNot(`${file} no longer claims zero-copy`, /零代码复制|零拷贝/, text)
}

if (failures > 0) process.exit(1)
console.log('docs: ok')
