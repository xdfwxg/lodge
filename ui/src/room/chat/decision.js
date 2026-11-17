import { normalizeHandoff } from '../../../../shared/handoff.js'
import { buildIdleDecision } from '../decision.js'

export const chatConclusionOf = room => {
  const message = [...(room.messages ?? [])].reverse().find(item => item.kind === 'chat_conclusion')
  return message === undefined ? null : message
}

export const chatConclusionHandoffOf = message => normalizeHandoff(message?.meta?.handoff)

// 聊天室只关心：讨论中、出结论、已确认、中断；没有阶段和验收。
export const buildChatDecision = room => {
  const idle = buildIdleDecision(room)
  if (idle !== null) return idle
  const chat = room.chat ?? {}
  const conclusion = chatConclusionOf(room)
  const handoff = chatConclusionHandoffOf(conclusion)
  const summary = handoff?.consensus?.[0] ?? handoff?.topic ?? ''

  if (chat.phase === 'concluded') {
    return {
      key: 'chat-concluded',
      title: '聊完了',
      detail: summary.length > 260 ? `${summary.slice(0, 260)}…` : summary,
      primary: null,
      secondary: null,
    }
  }
  if (chat.running === true) {
    return { key: 'chat-running', title: '正在聊', detail: '成员正在发言', primary: null, secondary: null }
  }
  return {
    key: 'chat-interrupted',
    title: '刚才断了',
    detail: '再发一句就能接着说。',
    primary: null,
    secondary: null,
  }
}
