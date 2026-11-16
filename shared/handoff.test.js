import assert from 'node:assert/strict'
import test from 'node:test'
import { handoffGoalText, normalizeHandoff, parseHandoffFromText } from './handoff.js'

test('a structured conclusion becomes five handoff fields', () => {
  const handoff = parseHandoffFromText(`
## 主题
发布前检查清单
## 共识
- 需要覆盖代码、发布、回滚
- 每条都要有负责人
**要点**
## 未解决分歧
- 是否需要自动回滚
## 约束条件
- 单文件 Markdown
## 待办
- 执行官写初稿
- 验收员核对结构
`, '默认主题')
  assert.deepEqual(handoff, {
    topic: '发布前检查清单',
    consensus: ['需要覆盖代码、发布、回滚', '每条都要有负责人'],
    disagreements: ['是否需要自动回滚'],
    constraints: ['单文件 Markdown'],
    todos: ['执行官写初稿', '验收员核对结构'],
  })
  assert.match(handoffGoalText(handoff), /主题|发布前检查清单/)
  assert.match(handoffGoalText(handoff), /分歧：是否需要自动回滚/)
})

test('inline section labels are understood', () => {
  const handoff = parseHandoffFromText('共识：先做最小版本\n分歧：是否上线\n待办：写清单', '讨论')
  assert.equal(handoff.topic, '讨论')
  assert.deepEqual(handoff.consensus, ['先做最小版本'])
  assert.deepEqual(handoff.disagreements, ['是否上线'])
  assert.deepEqual(handoff.todos, ['写清单'])
})

test('a plain conclusion becomes a topic and one consensus item', () => {
  const handoff = parseHandoffFromText('大家认为先做导出，暂时不做同步。', '导出')
  assert.equal(handoff.topic, '导出')
  assert.deepEqual(handoff.consensus, ['大家认为先做导出，暂时不做同步。'])
})

test('placeholder values become empty fields, not bullets', () => {
  const handoff = parseHandoffFromText(`
## 主题
发布前检查
## 共识
- 无
## 分歧
- 暂无
## 约束
- 不适用
## 待办
- 没有
`, '兜底主题')
  assert.deepEqual(handoff, {
    topic: '发布前检查',
    consensus: [],
    disagreements: [],
    constraints: [],
    todos: [],
  })
})

test('handoff values are bounded and empty values are rejected', () => {
  assert.equal(normalizeHandoff(null), null)
  assert.equal(normalizeHandoff({ topic: '', consensus: [], disagreements: [], constraints: [], todos: [] }), null)
  const handoff = normalizeHandoff({
    topic: 'x'.repeat(500),
    consensus: Array.from({ length: 10 }, (_, index) => `共识${index}`),
    disagreements: [],
    constraints: [],
    todos: [],
  })
  assert.equal(handoff.topic.length, 300)
  assert.equal(handoff.consensus.length, 6)
})
