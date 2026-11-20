import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { humanLabelOf, humanNameOf } from '../../human-name.js'

// 用户只对主持说话；主持判断是直接回答，还是从固定成员里请人讨论。
// 轮数、成员数和发言次数都属于房间配置，不从这里改。
// Lodge 自己是一间没有成员的对话：它判断不了就回复，要做事或找人就走 open。
export const hostIntentPrompt = ({ room, text, turnLimit, phase = '' }) => {
  const roster = (room.members ?? [])
    .map(member => `${member.id}（${member.name}）`)
    .join('、')
  const stateLine = phase === 'awaiting_decision' || phase === 'accepted'
    ? '房间已经有一份结论；用户再说话就是在继续这件事。'
    : ''
  const humanName = humanNameOf(room)
  const humanLine = humanName === '' ? '' : `用户称呼：${humanName}。`
  const lodge = room.lodge === true && roster === ''
  const rules = lodge
    ? [
      '判断规则：',
      '- 要交一个具体结果（文件、清单、链接、对比表、代码、查价、订票等）→ open studio。',
      '- 要找几个人一起看、一起讨论、听不同意见（大伙、大家、团队、多几个人、一起商量）→ open chat。',
      '- 只是聊聊、拿主意、还没想清楚 → reply。',
      '- 消息里带 <attached-image> 或 <attached-file> 标记时，附件会跟着目标一起进新房；该做事就照样 open。',
      '要开房时，reply 用一句人话告诉对方开什么；不需要就先空着，平台会补一句“开好了”。',
      '只输出 JSON，不要 Markdown，不要解释：',
      '{"action":"reply","reply":"直接对用户说的话"}',
      '或 {"action":"open","room":"studio" 或 "chat","reply":"可选的一句"}',
    ]
    : [
      '判断规则：',
      '- 用户要“再走一轮、继续讨论、让大家说说、听听成员意见”，或问题需要多人观点时，用 round。',
      '- 用户只是在问你、要一句回答时，用 reply。',
      '- reply 只写回答本身，不要写“再走一轮”“我请人来说”这类流程话；要开轮就直接选 round。',
      '- 从固定成员里选 1–3 位，不要编造成员。',
      '例如用户说“再走一轮：这轮把 A 和 B 定下来”，就选 {"action":"round",...}，不要只复述这两个议题。',
      '只输出 JSON，不要 Markdown，不要解释：',
      '{"action":"reply","reply":"直接对用户说的话"}',
      '或 {"action":"round","speakers":["固定成员 id"],"reply":"可选的一句"}',
    ]
  return [
    `你是 Lodge 主持，负责接住用户的话。固定成员：${roster || '无'}。`,
    lodge ? '' : `房间每轮固定 ${turnLimit} 次发言，主持不占发言位。`,
    humanLine,
    stateLine,
    `${humanLabelOf(room)}说：${text}`,
    ...rules,
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}


// 用户已经把“要再讨论”说出口时，主持不该只复述一句。
export const askedForRound = text => /再走一轮|再来一轮|继续讨论|再聊一轮|大家说说|让大家说|开一轮|讨论一轮/.test(String(text ?? ''))

// 模型偶尔把“再走一轮”复述成一句回答；用户已经把话说清时，补开一轮，不改轮次和成员。
export const ensureRoundWhenAsked = (intent, text, room) => {
  if (intent.action === 'round') return intent
  if (!askedForRound(text)) return intent
  const speakers = (room.members ?? []).map(member => member.id).slice(0, 3)
  return speakers.length === 0
    ? intent
    : { action: 'round', speakers, reply: intent.reply, structured: true }
}

const clean = raw => String(raw ?? '')
  .replace(/^```(?:json)?\s*/i, '')
  .replace(/```$/i, '')
  .trim()

export const parseHostIntent = (raw, { speakers = [], allowOpen = false } = {}) => {
  const text = clean(raw)
  const json = text.match(/\{[\s\S]*\}/)?.[0] ?? text
  let value = null
  try {
    value = JSON.parse(json)
  } catch {
    return { action: 'reply', reply: text, speakers: [], structured: false }
  }
  if (allowOpen && value?.action === 'open' && (value?.room === 'studio' || value?.room === 'chat')) {
    return {
      action: 'open',
      room: value.room,
      reply: typeof value?.reply === 'string' ? value.reply.trim() : '',
      speakers: [],
      structured: true,
    }
  }
  const action = value?.action === 'round' ? 'round' : 'reply'
  const allowed = new Set(speakers)
  const selected = Array.isArray(value?.speakers)
    ? [...new Set(value.speakers.filter(id => typeof id === 'string' && allowed.has(id)))].slice(0, 3)
    : []
  const reply = typeof value?.reply === 'string' ? value.reply.trim() : ''
  if (action === 'round' && selected.length > 0) return { action, reply, speakers: selected, structured: true }
  return { action: 'reply', reply: reply || text || '我在。', speakers: [], structured: true }
}
