import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'

// 用户只对主持说话；主持判断是直接回答，还是从固定成员里请人讨论。
// 轮数、成员数和发言次数都属于房间配置，不从这里改。
export const hostIntentPrompt = ({ room, text, turnLimit }) => {
  const roster = (room.members ?? [])
    .map(member => `${member.id}（${member.name}）`)
    .join('、')
  return [
    `你是 Lodge 主持，负责接住用户的话。固定成员：${roster || '无'}。`,
    `房间每轮固定 ${turnLimit} 次发言，主持不占发言位。`,
    `用户说：${text}`,
    '只输出 JSON，不要 Markdown，不要解释：',
    '{"action":"reply","reply":"直接对用户说的话"}',
    '或 {"action":"round","speakers":["固定成员 id"],"reply":"可选的一句"}',
    '需要多人观点时才选 round；从固定成员里选，最多 3 位，不要编造成员。',
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}

const clean = raw => String(raw ?? '')
  .replace(/^```(?:json)?\s*/i, '')
  .replace(/```$/i, '')
  .trim()

export const parseHostIntent = (raw, { speakers = [] } = {}) => {
  const text = clean(raw)
  const json = text.match(/\{[\s\S]*\}/)?.[0] ?? text
  let value = null
  try {
    value = JSON.parse(json)
  } catch {
    return { action: 'reply', reply: text, speakers: [] }
  }
  const action = value?.action === 'round' ? 'round' : 'reply'
  const allowed = new Set(speakers)
  const selected = Array.isArray(value?.speakers)
    ? [...new Set(value.speakers.filter(id => typeof id === 'string' && allowed.has(id)))].slice(0, 3)
    : []
  const reply = typeof value?.reply === 'string' ? value.reply.trim() : ''
  if (action === 'round' && selected.length > 0) return { action, reply, speakers: selected }
  return { action: 'reply', reply: reply || text || '我在。', speakers: [] }
}
