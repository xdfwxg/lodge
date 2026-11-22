import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { memberOf } from '../../room-members.js'
import { humanLabelOf, humanNameOf } from '../../human-name.js'
import { personalityTurnCue } from '../../../../shared/personalities.js'

const truncate = (text, limit) => {
  const value = String(text ?? '').trim()
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

// 群聊本身已有讨论记录；提示词只放当前动作，不重复整段历史。
export const speakerPrompt = ({ room, memberId, round, turn, turnLimit, note, brief = '', previous = null }) => {
  const speaker = memberOf(room, memberId)
  const hostName = humanNameOf()
  return [
    `聊天室话题：${room.goal}`,
    hostName === '' ? '' : `用户称呼：${hostName}。`,
    `第 ${round} 轮，第 ${turn}/${turnLimit} 次发言。`,
    note === '' ? '' : `${humanLabelOf()}这轮的要求：${note}`,
    brief === '' ? '' : `上一轮结论：${brief}`,
    previous === null ? '' : `上一位：${previous.name}说“${truncate(previous.text, 200)}”`,
    '接着上面说：同意就补一个理由，不同意就指出哪一点，有疑问就只问一个具体问题。不要重复别人。可只读查文件或联网查资料，引用路径或链接；不写文件、不跑命令，外部动作先问人。',
    '按顺序轮流说；不用 @ 别人，也不用把话交给别人。',
    '像普通人聊天一样说自己的看法，不用报告、分点或小标题。',
    '只讨论话题本身；不要评论讨论次数、样本数量或流程。',
    `本轮表达：${personalityTurnCue(speaker?.personality)}`,
    '每次发言控制在 200 字以内；不要写总结。',
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}

export const hostPrompt = ({ room, round, note, turnLimit, structured = false }) => {
  const common = [
    `聊天室第 ${round} 轮讨论到此结束，请总结。`,
    `话题：${room.goal}`,
    `固定成员：${(room.members ?? []).map(member => `${member.id}（${member.name}）`).join('、') || '无'}；本轮上限 ${turnLimit} 次发言。`,
    note === '' ? '' : `${humanLabelOf()}这轮的要求：${note}`,
    '只写本轮结论，不要寒暄，不要逐条复述发言，不要调用工具。',
  ]
  if (!structured) {
    return [...common,
      '写 2–4 句自然中文：这轮落在哪、还有哪条真分歧或风险、下一步如果要做什么。',
      '如果明确有下一步，最后单独一行写「下一步：一句话」；没有就不写。',
      '不要标题、不要分点、不要五段模板；总长不超过 300 字。',
      INTERNAL_PROMPT_MARKER,
    ].filter(Boolean).join('\n')
  }
  return [...common,
    '用户明确要清单/分点/待办；严格按下面五段输出，标题固定：',
    '## 主题',
    '一句话说清这轮在解决什么。',
    '## 共识',
    '- 已达成的结论，最多 5 条',
    '## 分歧',
    '- 未解决的分歧，最多 5 条；没有写「无」',
    '## 约束',
    '- 前提、限制、风险，最多 5 条；没有写「无」',
    '## 待办',
    '- 下一步要做什么，最多 5 条；没有写「无」',
    '每段不超过 100 字，总长不超过 800 字。',
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}

export const wantsStructuredSummary = note => /分点|分条|逐条|列成|列出|罗列|清单|列表|表格|待办|五段|结构化|大纲|提纲|\b(?:bullet|list|table|checklist)\b/i.test(String(note ?? ''))

export const digestText = lines => lines.length === 0
  ? '讨论没有产生可总结的内容。'
  : `主持人未能在限定时间内总结。以下是本轮讨论记录：\n\n${lines.join('\n')}`
