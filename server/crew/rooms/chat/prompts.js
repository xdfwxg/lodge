import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { humanLabelOf, humanNameOf } from '../../human-name.js'
import { sanitizeUntrusted } from '../../../../shared/untrusted-text.js'

const truncate = (text, limit) => {
  const value = String(text ?? '').trim()
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

// 群聊本身已有讨论记录；提示词只放当前动作，不重复整段历史。
export const speakerPrompt = ({ room, memberId, round, turn, turnLimit, note, brief = '', previous = null, focus = '' }) => {
  const hostName = humanNameOf()
  return [
    `聊天室话题：${room.goal}`,
    hostName === '' ? '' : `用户称呼：${hostName}。`,
    `第 ${round} 轮，第 ${turn}/${turnLimit} 次发言。`,
    note === '' || note === undefined || note === null ? '' : `${humanLabelOf()}这轮的要求：${note}`,
    brief === '' ? '' : `上一轮结论：${sanitizeUntrusted(brief, 1200)}`,
    focus === '' ? '' : `今晚你的焦点：${sanitizeUntrusted(focus, 200)}`,
    previous === null
      ? '这是本轮第一句：直接说自己的判断，不用回答谁。'
      : `上一位：${sanitizeUntrusted(previous.name, 40)}说“${sanitizeUntrusted(truncate(previous.text, 160), 160)}”`,
    '像群聊一样，一条消息只说一个想法；多数 15–35 字，可以只说“同意”或问一句。要展开时最多 2 个短点，总长不超过 80 字。',
    '可以接话、反驳，但保留自己的判断，不要为了合群改口；改变立场时说明是哪条依据说服了你。',
    '可只读查文件或联网查资料，引用路径或链接；不写文件、不跑命令，外部动作先问人。',
    '先说结论再展开；多点用短列表或加粗小标题；**加粗**一条消息最多一处，只给数字、时间或风险；不贴表格。',
    '不要写报告或工作日志；不要 @ 别人，也不要评论轮次和流程。',
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}

// 结论复核只有一件事：结论有没有超出对话记录。它不是新发言，也不重开讨论。
export const conclusionReviewPrompt = ({ room, reviewer, conclusion, transcript = '' }) => [
  `你是「${room?.name ?? '聊天室'}」这一轮结论的复核人：${reviewer?.name ?? '成员'}。`,
  `话题：${room?.goal ?? ''}`,
  `结论原文：${sanitizeUntrusted(conclusion, 2000)}`,
  transcript === '' ? '' : `本轮讨论记录：\n${sanitizeUntrusted(transcript, 4000)}`,
  '只核对结论有没有超出讨论记录的依据；不评价好坏，不重开讨论，不给新建议。',
  '第一行只写 PASS 或 CONCERN；第二行一句话说明。CONCERN 时写清哪一句没有依据。',
  '不要 @ 任何人。',
  INTERNAL_PROMPT_MARKER,
].filter(Boolean).join('\n')

export const hostPrompt = ({ room, round, note, turnLimit, structured = false }) => {
  const castIds = Array.isArray(room.chat?.castIds) ? room.chat.castIds : []
  const cast = castIds.length === 0 ? (room.members ?? []) : (room.members ?? []).filter(member => castIds.includes(member.id))
  const common = [
    '聊天室这轮讨论到此结束，请总结。',
    `话题：${room.goal}`,
    `今晚在座：${cast.map(member => `${member.id}（${member.name}）`).join('、') || '无'}；本轮上限 ${turnLimit} 次发言。`,
    note === '' || note === undefined || note === null ? '' : `${humanLabelOf()}这轮的要求：${note}`,
    '只写本轮结论，不要寒暄，不要逐条复述发言，不要调用工具。',
    '不要写“第 N 轮”、轮次或发言次数；直接写结论。',
  ]
  if (!structured) {
    return [...common,
      '先一句话给结论：这轮聊出了什么；需要展开时用不超过 3 个短点（编号或加粗小标题），每点只讲一个意思。',
      '**加粗**只给结论、数字、金额、时间和风险点；不要整段加粗。并列用列表，不放进表格；段落之间空一行。',
      '不逐条复述，不写“共识/分歧/未定”三栏。',
      '总长不超过 100 字，目标 60–80 字。',
      INTERNAL_PROMPT_MARKER,
    ].filter(Boolean).join('\n')
  }
  return [...common,
    '用户明确要清单/分点/待办；严格按下面六段输出，标题固定：',
    '## 主题',
    '一句话说清这轮在解决什么。',
    '## 共识',
    '- 已达成的结论，最多 5 条',
    '## 分歧',
    '- 未解决的分歧，最多 5 条；没有写「无」',
    '## 未定',
    '- 缺依据、没验证或要人拍板的事，最多 5 条；没有写「无」',
    '## 约束',
    '- 前提、限制、风险，最多 5 条；没有写「无」',
    '## 待办',
    '- 下一步要做什么，最多 5 条；没有写「无」',
    '每段不超过 100 字，总长不超过 800 字。',
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}

const STRUCTURED_SUMMARY = /分点|分条|逐条|列成|列出|罗列|清单|列表|表格|待办|六段|结构化|大纲|提纲|\b(?:bullet|list|table|checklist)\b/i
const NEGATED_STRUCTURED = /(?:不要|别|不用|不必|无需|不需要)[^。！？!?；;\n]{0,12}(?:分点|分条|逐条|列成|列出|罗列|清单|列表|表格|待办|六段|结构化|大纲|提纲|bullet|list|table|checklist)/gi

export const wantsStructuredSummary = note => {
  // “不要列表，简单说”是在拒绝格式，不是请求格式；先去掉被否定的那段再判断。
  const positive = String(note ?? '').replace(NEGATED_STRUCTURED, '')
  return STRUCTURED_SUMMARY.test(positive)
}

// 轮次只留在记录里，不进入结论正文；模型偶尔会把“第 N 轮”写进首句。
export const stripRoundLead = text => String(text ?? '')
  .replace(/^\s*第\s*[0-9一二三四五六七八九十]+\s*轮\s*[：:，,、\-—\s]*/u, '')
  .trim()

export const digestText = lines => lines.length === 0
  ? '讨论没有产生可总结的内容。'
  : `系统没能在限定时间内收结论。以下是本轮讨论记录：\n\n${lines.join('\n')}`
