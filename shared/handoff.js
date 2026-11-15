// 聊天室 → 工作室的唯一交接契约：只传这五样，不搬原始聊天记录。
export const HANDOFF_FIELDS = ['topic', 'consensus', 'disagreements', 'constraints', 'todos']

const LIST_LIMIT = 6
const ITEM_LIMIT = 300
const clean = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')
const listOf = value => (
  Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, LIST_LIMIT) : []
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
    topic: clean(value.topic).slice(0, ITEM_LIMIT),
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
  [/主题|议题|讨论题目/, 'topic'],
  [/共识|达成共识|一致的?结论|结论/, 'consensus'],
  [/分歧|未解决|争议|不同意见/, 'disagreements'],
  [/约束|限制|风险|前提/, 'constraints'],
  [/待办|下一步|行动项|后续/, 'todos'],
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
  const fallback = clean(fallbackTopic).slice(0, ITEM_LIMIT)
  let current = null
  const loose = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('```')) continue
    const inline = /^([^：:]{2,12})[：:]\s*(.+)$/.exec(stripTitle(line))
    const title = inline === null ? stripTitle(line) : inline[1].trim()
    const section = sectionOf(title)
    if (section !== null) {
      current = section
      if (inline !== null) {
        const value = clean(inline[2]).slice(0, ITEM_LIMIT)
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
    const value = clean(stripTitle(line)).slice(0, ITEM_LIMIT)
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
  if (handoff.consensus.length === 0 && handoff.disagreements.length === 0 &&
    handoff.constraints.length === 0 && handoff.todos.length === 0) {
    const plain = clean(text)
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
