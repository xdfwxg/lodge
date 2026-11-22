// 聊天室 → 工作室的唯一交接契约：只传这五样，不搬原始聊天记录。

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

export const emptyHandoff = () => ({
  topic: '',
  consensus: [],
  disagreements: [],
  constraints: [],
  todos: [],
})

export const normalizeHandoff = value => {
  if (value === null || typeof value !== 'object') return null
  const handoff = {
    topic: itemOf(value.topic).slice(0, ITEM_LIMIT),
    consensus: listOf(value.consensus),
    disagreements: listOf(value.disagreements),
    constraints: listOf(value.constraints),
    todos: listOf(value.todos),
  }
  const empty = handoff.topic === '' &&
    handoff.consensus.length === 0 &&
    handoff.disagreements.length === 0 &&
    handoff.constraints.length === 0 &&
    handoff.todos.length === 0
  return empty ? null : handoff
}

const SECTION = [
  [/^(主题|议题|讨论题目)$/, 'topic'],
  [/^(共识|达成共识|一致的?结论|结论)$/, 'consensus'],
  [/^(未解决(的)?分歧|主要分歧|分歧|争议|不同意见)$/, 'disagreements'],
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

export const parseHandoffFromText = (text, fallbackTopic = '') => {
  const handoff = emptyHandoff()
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
          if (current === 'topic') handoff.topic = value
          else if (handoff[current].length < LIST_LIMIT) handoff[current].push(value)
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
      if (handoff.topic === '') handoff.topic = value
      else if (handoff.consensus.length < LIST_LIMIT) handoff.consensus.push(value)
    } else if (current !== null) {
      if (handoff[current].length < LIST_LIMIT) handoff[current].push(value)
    } else if (bullet) {
      loose.push(value)
    }
  }
  if (handoff.consensus.length === 0 && loose.length > 0) handoff.consensus = loose.slice(0, LIST_LIMIT)
  // 显式主题段优先；没有主题段时才用房间目标兜底。
  if (handoff.topic === '' && fallback !== '') handoff.topic = fallback
  if (handoff.topic === '' && loose.length > 0) handoff.topic = loose[0].slice(0, ITEM_LIMIT)
  if (!sawSection && handoff.consensus.length === 0 && handoff.disagreements.length === 0 &&
    handoff.constraints.length === 0 && handoff.todos.length === 0) {
    const plain = itemOf(text)
    if (plain !== '' && plain !== handoff.topic) handoff.consensus = [plain.slice(0, ITEM_LIMIT)]
  }
  return normalizeHandoff(handoff)
}

export const handoffGoalText = handoff => {
  const normalized = normalizeHandoff(handoff)
  if (normalized === null) return ''
  const lines = [normalized.topic]
  const add = (label, values) => {
    if (values.length > 0) lines.push(`${label}：${values.join('；')}`)
  }
  add('共识', normalized.consensus)
  add('分歧', normalized.disagreements)
  add('约束', normalized.constraints)
  add('待办', normalized.todos)
  return lines.filter(Boolean).join('\n')
}
