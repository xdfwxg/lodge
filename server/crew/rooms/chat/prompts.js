import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { memberOf } from '../../room-members.js'
import { humanLabelOf, humanNameOf } from '../../human-name.js'
import { personalityTurnCue } from '../../../../shared/personalities.js'
import { sanitizeUntrusted } from '../../../../shared/untrusted-text.js'

const truncate = (text, limit) => {
  const value = String(text ?? '').trim()
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

const TURN_RULES = '不要重复别人。可只读查文件或联网查资料，引用路径或链接；不写文件、不跑命令，外部动作先问人。'

// 群聊本身已有讨论记录；提示词只放当前动作，不重复整段历史。
export const speakerPrompt = ({ room, memberId, round, turn, turnLimit, note, brief = '', previous = null }) => {
  const speaker = memberOf(room, memberId)
  const hostName = humanNameOf()
  return [
    `聊天室话题：${room.goal}`,
    hostName === '' ? '' : `用户称呼：${hostName}。`,
    `第 ${round} 轮，第 ${turn}/${turnLimit} 次发言。`,
    note === '' ? '' : `${humanLabelOf()}这轮的要求：${note}`,
    brief === '' ? '' : `上一轮结论：${sanitizeUntrusted(brief, 1200)}`,
    previous === null
      ? '这是本轮第一句：直接说自己的判断，不用回答谁。'
      : `上一位：${sanitizeUntrusted(previous.name, 40)}说“${sanitizeUntrusted(truncate(previous.text, 200), 200)}”`,
    previous === null
      ? `先说结论，再补一个理由；有疑问就只问一个具体问题。${TURN_RULES}`
      : `接着说：同意就补一个理由，不同意就指出哪一点，有疑问就只问一个具体问题。${TURN_RULES}`,
    '按顺序轮流说；不用 @ 别人，也不用把话交给别人。',
    '像普通人聊天一样说自己的看法。先说结论；有多点、步骤或对照时，用短列表或加粗小标题把层次说清，`路径`和命令放进行内代码；一句话说清的就别拆，也不要写报告标题或工作日志。',
    '只讨论话题本身；不要评论讨论次数、样本数量或流程。',
    `本轮表达：${personalityTurnCue(speaker?.personality)}`,
    '每次发言控制在 200 字以内；不要写总结。',
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
  const common = [
    '聊天室这轮讨论到此结束，请总结。',
    `话题：${room.goal}`,
    `固定成员：${(room.members ?? []).map(member => `${member.id}（${member.name}）`).join('、') || '无'}；本轮上限 ${turnLimit} 次发言。`,
    note === '' ? '' : `${humanLabelOf()}这轮的要求：${note}`,
    '只写本轮结论，不要寒暄，不要逐条复述发言，不要调用工具。',
    '不要写“第 N 轮”、轮次或发言次数；直接写结论。',
  ]
  if (!structured) {
    return [...common,
      '固定写三段，标题固定：共识、分歧、未定。',
      '共识：这轮已经达成的结论；分歧：还没解决的不同意见；未定：缺依据、没验证或要人拍板的事。',
      '每段最多 3 条，用分号分开；某段没有就写「无」，不要省略标题。',
      '如果明确有下一步，最后单独一行写「下一步：一句话」；没有就不写。',
      '不要寒暄，不要逐条复述发言，不要写“第 N 轮”；总长不超过 300 字。',
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
