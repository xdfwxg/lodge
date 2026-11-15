// 房间名不用模型：取目标第一行，去掉常见标签与包裹符号，超长截断。
const LABEL = /^(目标|聊天室结论|结论|话题|主题)\s*[:：]\s*/
const CLAUSE = /[，。；！？;]/
const stripWrap = text => text.replace(/^[【「“"']+/, '').replace(/[】」”"']+$/, '').trim()

const firstClause = text => {
  const match = CLAUSE.exec(text)
  if (match === null) return text
  const head = text.slice(0, match.index).trim()
  return Array.from(head).length >= 4 ? head : text
}

export const roomNameFromGoal = (goal, limit = 24) => {
  const line = String(goal ?? '').split(/\r?\n/).map(item => item.trim()).find(Boolean) ?? ''
  const cleaned = firstClause(stripWrap(line.replace(LABEL, ''))).replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  return chars.length <= limit ? cleaned : `${chars.slice(0, limit).join('')}…`
}
