// 聊天室 → 工作室的唯一交接契约：只传这六样，不搬原始聊天记录。

const LIST_LIMIT = 6
const ITEM_LIMIT = 300
const EMPTY_ITEM = /^(无|暂无|没有|不适用|none|n\/a|—|-)$/i
const clean = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')
const itemOf = value => {
  const text = clean(value)
  return text === '' || EMPTY_ITEM.test(text) ? '' : text
}
const listOf = value => (
  Array.isArray(value) ? value.map(itemOf).filter(Boolean).slice(0, LIST_LIMIT) : []
)

export const emptyHandoffBrief = () => ({
  topic: '',
  consensus: [],
  disagreements: [],
  unknowns: [],
  constraints: [],
  todos: [],
})

export const normalizeHandoffBrief = value => {
  if (value === null || typeof value !== 'object') return null
  const brief = {
    topic: itemOf(value.topic).slice(0, ITEM_LIMIT),
    consensus: listOf(value.consensus),
    disagreements: listOf(value.disagreements),
    unknowns: listOf(value.unknowns),
    constraints: listOf(value.constraints),
    todos: listOf(value.todos),
  }
  const empty = brief.topic === '' &&
    brief.consensus.length === 0 &&
    brief.disagreements.length === 0 &&
    brief.unknowns.length === 0 &&
    brief.constraints.length === 0 &&
    brief.todos.length === 0
  return empty ? null : brief
}

const SECTION = [
  [/^(主题|议题|讨论题目)$/, 'topic'],
  [/^(共识|达成共识|一致的?结论|结论)$/, 'consensus'],
  [/^(未解决(的)?分歧|主要分歧|分歧|争议|不同意见)$/, 'disagreements'],
  [/^(未定|未确定|未确认|待定|待验证|未知|开放问题|悬而未决)$/, 'unknowns'],
  [/^(约束(条件)?|限制|风险|前提)$/, 'constraints'],
  [/^(待办|下一步|行动项|后续)$/, 'todos'],
]

const sectionOf = title => SECTION.find(([pattern]) => pattern.test(title))?.[1] ?? null
const stripTitle = line => line
  .replace(/^#{1,6}\s*/, '')
  .replace(/^\*\*|\*\*$/g, '')
  .replace(/^[-*•]\s*/, '')
  .replace(/^\d+[.、)]\s*/, '')
  .trim()

export const parseHandoffBriefFromText = (text, fallbackTopic = '') => {
  const brief = emptyHandoffBrief()
  const fallback = itemOf(fallbackTopic).slice(0, ITEM_LIMIT)
  let current = null
  let sawSection = false
  const loose = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('```')) continue
    const inline = /^([^：:]{2,12})[：:]\s*(.+)$/.exec(stripTitle(line))
    const title = inline === null ? stripTitle(line) : inline[1].trim()
    const section = sectionOf(title)
    if (section !== null) {
      current = section
      sawSection = true
      if (inline !== null) {
        const value = itemOf(inline[2]).slice(0, ITEM_LIMIT)
        if (value !== '') {
          if (current === 'topic') brief.topic = value
          else if (brief[current].length < LIST_LIMIT) brief[current].push(value)
        }
      }
      continue
    }
    // 「**要点**」这类小标题不是一条共识，别把它当成列表项。
    if (/^\*\*[^*]+\*\*$/.test(line) || /^#{1,6}\s+/.test(line)) continue
    const bullet = /^[-*•]\s+|^\d+[.、)]\s+/.test(line)
    const value = itemOf(stripTitle(line)).slice(0, ITEM_LIMIT)
    if (value === '') continue
    if (current === 'topic') {
      if (brief.topic === '') brief.topic = value
      else if (brief.consensus.length < LIST_LIMIT) brief.consensus.push(value)
    } else if (current !== null) {
      if (brief[current].length < LIST_LIMIT) brief[current].push(value)
    } else if (bullet) {
      loose.push(value)
    }
  }
  if (brief.consensus.length === 0 && loose.length > 0) brief.consensus = loose.slice(0, LIST_LIMIT)
  // 显式主题段优先；没有主题段时才用房间目标兜底。
  if (brief.topic === '' && fallback !== '') brief.topic = fallback
  if (brief.topic === '' && loose.length > 0) brief.topic = loose[0].slice(0, ITEM_LIMIT)
  if (!sawSection && brief.consensus.length === 0 && brief.disagreements.length === 0 &&
    brief.unknowns.length === 0 && brief.constraints.length === 0 && brief.todos.length === 0) {
    const plain = itemOf(text)
    if (plain !== '' && plain !== brief.topic) brief.consensus = [plain.slice(0, ITEM_LIMIT)]
  }
  return normalizeHandoffBrief(brief)
}

export const handoffBriefGoalText = brief => {
  const normalized = normalizeHandoffBrief(brief)
  if (normalized === null) return ''
  const lines = [normalized.topic]
  const add = (label, values) => {
    if (values.length > 0) lines.push(`${label}：${values.join('；')}`)
  }
  add('共识', normalized.consensus)
  add('分歧', normalized.disagreements)
  add('未定', normalized.unknowns)
  add('约束', normalized.constraints)
  add('待办', normalized.todos)
  return lines.filter(Boolean).join('\n')
}
