import assert from 'node:assert/strict'
import test from 'node:test'
import { handoffBriefGoalText, normalizeHandoffBrief, parseHandoffBriefFromText } from './handoff-brief.js'

test('a structured conclusion becomes six brief fields', () => {
  const brief = parseHandoffBriefFromText(`
## 主题
发布前检查清单
## 共识
- 需要覆盖代码、发布、回滚
- 每条都要有负责人
**要点**
## 未解决分歧
- 是否需要自动回滚
## 未定
- 自动回滚的黑盒验证还没跑
## 约束条件
- 单文件 Markdown
## 待办
- 执行官写初稿
- 验收员核对结构
`, '默认主题')
  assert.deepEqual(brief, {
    topic: '发布前检查清单',
    consensus: ['需要覆盖代码、发布、回滚', '每条都要有负责人'],
    disagreements: ['是否需要自动回滚'],
    unknowns: ['自动回滚的黑盒验证还没跑'],
    constraints: ['单文件 Markdown'],
    todos: ['执行官写初稿', '验收员核对结构'],
  })
  assert.match(handoffBriefGoalText(brief), /主题|发布前检查清单/)
  assert.match(handoffBriefGoalText(brief), /分歧：是否需要自动回滚/)
  assert.match(handoffBriefGoalText(brief), /未定：自动回滚的黑盒验证还没跑/)
})

test('inline section labels are understood', () => {
  const brief = parseHandoffBriefFromText('共识：先做最小版本\n分歧：是否上线\n未定：上线窗口\n待办：写清单', '讨论')
  assert.equal(brief.topic, '讨论')
  assert.deepEqual(brief.consensus, ['先做最小版本'])
  assert.deepEqual(brief.disagreements, ['是否上线'])
  assert.deepEqual(brief.unknowns, ['上线窗口'])
  assert.deepEqual(brief.todos, ['写清单'])
})

test('a plain conclusion becomes a topic and one consensus item', () => {
  const brief = parseHandoffBriefFromText('大家认为先做导出，暂时不做同步。', '导出')
  assert.equal(brief.topic, '导出')
  assert.deepEqual(brief.consensus, ['大家认为先做导出，暂时不做同步。'])
})

test('placeholder values become empty fields, not bullets', () => {
  const brief = parseHandoffBriefFromText(`
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
  assert.deepEqual(brief, {
    topic: '发布前检查',
    consensus: [],
    disagreements: [],
    unknowns: [],
    constraints: [],
    todos: [],
  })
})

test('brief values are bounded and empty values are rejected', () => {
  assert.equal(normalizeHandoffBrief(null), null)
  assert.equal(normalizeHandoffBrief({ topic: '', consensus: [], disagreements: [], unknowns: [], constraints: [], todos: [] }), null)
  const brief = normalizeHandoffBrief({
    topic: 'x'.repeat(500),
    consensus: Array.from({ length: 10 }, (_, index) => `共识${index}`),
    disagreements: [],
    unknowns: [],
    constraints: [],
    todos: [],
  })
  assert.equal(brief.topic.length, 300)
  assert.equal(brief.consensus.length, 6)
})
