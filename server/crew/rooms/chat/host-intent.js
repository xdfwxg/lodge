import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { humanLabelOf, humanNameOf } from '../../human-name.js'
import { CHAT_PHASE } from '../../../../shared/states.js'

// 用户只对主持说话；主持默认只回答。开轮只由 @所有人 或用户明确要求触发。
// 轮数、成员数和发言次数都属于房间配置，不从这里改。
// Lodge 自己是一间没有成员的对话：它判断不了就回复，要做事或找人就走 open。
export const hostIntentPrompt = ({ room, text, turnLimit, phase = '', linkedRooms = [] }) => {
  const roster = (room.members ?? [])
    .map(member => `${member.id}（${member.name}）`)
    .join('、')
  const stateLine = phase === CHAT_PHASE.concluded
    ? '房间已经有一份结论；用户再说话就是在继续这件事。'
    : ''
  const humanName = humanNameOf()
  const humanLine = humanName === '' ? '' : `用户称呼：${humanName}。`
  const lodge = room.lodge === true && roster === ''
  const linked = (Array.isArray(linkedRooms) ? linkedRooms : [])
    .slice(0, 3)
    .map(item => `- ${item.name}：${item.conclusion === '' ? item.status : `${item.status}；最后结论：${item.conclusion}`}`)
  const grillRule = '用户说“拷问我/grill me/来拷问我”，或说“帮我理理/拿不准/不知道从哪开始”时，用 reply 一次只问一个最关键的问题；不要开轮、不要开房、不要叫成员发言。用户回答后继续问下一个；用户说“够了/开始做”时，把已确认的点收成一段结论。'
  const rules = lodge
    ? [
      // 身份和判断规则在主持人的 soul 里；这里只给这次的动作和输出形状。
      '这次只决定一件事：直接回答，还是开一间工作室 / 聊天室。判断规则按你的身份说明。',
      '- 要交一个具体结果（文件、清单、链接、对比表、代码、查价、订票等）→ open studio。',
      '- 要找几个人一起看、一起讨论、听不同意见（大伙、大家、团队、多几个人、一起商量）→ open chat。',
      '- 只是聊聊、拿主意、还没想清楚 → reply。',
      '- 消息里带 <attached-image> 或 <attached-file> 标记时，附件会跟着目标一起进新房；该做事就照样 open。',
      '要开房时，同时给 goal：用用户要完成的事写一句可开工的目标，保留对话里的对象和上下文；不要把“找人一起评/开始吧”这类动作短语当成目标。',
      '例如用户说“找人一起评”，goal 应写“一起评价短篇《开锁》哪里好、哪里要改”，不是“找人一起评”。',
      '如果从这里开出去的房已经有结论，直接接着结论说，不要让用户再等或把内容贴过来。',
      'reply 用一句人话告诉对方开什么；不需要就先空着，平台会补一句“开好了”。',
      '只输出 JSON，不要 Markdown，不要解释：',
      '{"action":"reply","reply":"直接对用户说的话"}',
      '或 {"action":"open","room":"studio" 或 "chat","goal":"要完成的事","reply":"可选的一句"}',
    ]
    : [
      '判断规则：',
      grillRule,
      '- 只有用户明确要求再讨论（如“再走一轮”“大家说说”“让大家讨论”），才输出 round，并在 speakers 里列出 1–3 个固定成员 id；其他情况一律 reply。',
      '- 不要因为问题本身需要多人观点就开轮；拿不准就 reply。',
      '- reply 只写回答本身，不要写“再走一轮”“我请人来说”这类流程话。',
      '只输出 JSON，不要 Markdown，不要解释：',
      '{"action":"reply","reply":"直接对用户说的话"}',
      '或 {"action":"round","speakers":["成员id"],"reply":"可选的一句"}',
    ]
  return [
    `你是 Lodge 主持，负责接住用户的话。固定成员：${roster || '无'}。`,
    lodge ? '' : `房间每轮固定 ${turnLimit} 次发言，主持不占发言位。`,
    humanLine,
    stateLine,
    linked.length === 0 ? '' : `从这里开出去的房：\n${linked.join('\n')}`,
    `${humanLabelOf()}说：${text}`,
    ...rules,
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}


// 开轮与否由主持模型判断；正则只拦“整句都在拒绝”的情况。
// 否定只覆盖到分句末尾：跨过逗号会把后半句的请求一起吃掉。
// “不用等太久再走一轮”这类是请求，不是拒绝，所以“不用/不必/无需”只认紧贴轮次短语的写法。
const ROUND_PHRASE = '(?:走一轮|来一轮|聊一轮|继续讨论|再讨论|开一轮|讨论一轮|大家说说|让大家说|多说一轮|讨论)'
const DIRECT_REFUSAL = new RegExp(`(?:不用|不必|无需|没必要|不需要)(?:再|急着|忙着)?${ROUND_PHRASE}`)
const REFUSAL = new RegExp(`(?:不(?!是|过|但|只|用|必|需|反对|否认|拒绝|介意)|(?<![特个])别|不要|先不|先别)[^。！？!?；;，,、\\n就]{0,12}${ROUND_PHRASE}`)
const CONTRAST_AFTER = /(?:但|不过|可是|然而)/

export const roundVetoed = text => {
  const value = String(text ?? '')
  const match = DIRECT_REFUSAL.exec(value) ?? REFUSAL.exec(value)
  if (match === null) return false
  return !CONTRAST_AFTER.test(value.slice(match.index + match[0].length))
}

// 模型说 round 就 round；只有用户明确拒绝、且后面没有转折时改回 reply。
// round 的 reply 是可选的；否决后没有话可说时补一句，避免把空消息写进房间。
const VETOED_REPLY = '好，那这次先不开了。'

export const finalizeHostIntent = (intent, text) => {
  if (intent.action !== 'round') return intent
  return roundVetoed(text)
    ? { ...intent, action: 'reply', speakers: [], reply: intent.reply || VETOED_REPLY }
    : intent
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
      goal: typeof value?.goal === 'string' ? value.goal.trim().slice(0, 2_000) : '',
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
