import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { humanLabelOf, humanNameOf } from '../../human-name.js'
import { CHAT_PHASE } from '../../../../shared/states.js'

// 用户只对主持说话；主持默认只回答。开轮只由 @所有人 或用户明确要求触发。
// 轮数、成员数和发言次数都属于房间配置，不从这里改。
// Lodge 自己是一间没有成员的对话：它判断不了就回复，要做事或找人就走 open。
export const hostIntentPrompt = ({ room, text, turnLimit, phase = '' }) => {
  const roster = (room.members ?? [])
    .map(member => `${member.id}（${member.name}）`)
    .join('、')
  const stateLine = phase === CHAT_PHASE.concluded
    ? '房间已经有一份结论；用户再说话就是在继续这件事。'
    : ''
  const humanName = humanNameOf(room)
  const humanLine = humanName === '' ? '' : `用户称呼：${humanName}。`
  const lodge = room.lodge === true && roster === ''
  const grillRule = '用户说“拷问我/grill me/来拷问我”，或说“帮我理理/拿不准/不知道从哪开始”时，用 reply 一次只问一个最关键的问题；不要开轮、不要开房、不要叫成员发言。用户回答后继续问下一个；用户说“够了/开始做”时，把已确认的点收成一段结论。'
  const rules = lodge
    ? [
      // 身份和判断规则在主持人的 soul 里；这里只给这次的动作和输出形状。
      '这次只决定一件事：直接回答，还是开一间工作室 / 聊天室。判断规则按你的身份说明。',
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
      grillRule,
      '- 你只回答，不自己开轮。即使问题需要多人观点，也只写 reply；开轮由用户 @所有人 或明确说“再走一轮/大家说说”触发。',
      '- reply 只写回答本身，不要写“再走一轮”“我请人来说”这类流程话。',
      '只输出 JSON，不要 Markdown，不要解释：',
      '{"action":"reply","reply":"直接对用户说的话"}',
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
// 先去掉“先不继续讨论/不要再走一轮”这类否定短语，避免把拒绝听成请求。
const ROUND_REQUEST = /再走一轮|再来一轮|继续讨论|再聊一轮|大家说说|让大家说|开一轮|讨论一轮/
// 否定只覆盖到分句末尾：跨过逗号会把后半句的请求一起吃掉。
const ROUND_NEGATION = /(?:不(?!是)|别|不要|不用|不必|无需|没必要|先不|别再|先别)[^。！？!?；;，,、\n]{0,12}(?:再走一轮|再来一轮|继续讨论|再聊一轮|大家说说|让大家说|开一轮|讨论一轮)/g

export const askedForRound = text => ROUND_REQUEST.test(String(text ?? '').replace(ROUND_NEGATION, ''))

// 主持只能回答；只有用户明确要求时才补一轮，模型自己选的 round 不算。
export const finalizeHostIntent = (intent, text, room) => {
  if (intent.action === 'open') return intent
  if (!askedForRound(text)) {
    return intent.action === 'round'
      ? { ...intent, action: 'reply', speakers: [] }
      : intent
  }
  if (intent.action === 'round') return intent
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
