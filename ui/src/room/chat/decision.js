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

  if (room.state === 'complete') {
    return {
      key: 'chat-complete',
      title: '这次聊完了',
      detail: summary.length > 260 ? `${summary.slice(0, 260)}…` : summary,
      primary: { label: '用结论开工', action: 'start-studio' },
      secondary: null,
    }
  }
  if (chat.running === true) {
    return { key: 'chat-running', title: '正在聊', detail: '成员正在发言', primary: null, secondary: null }
  }
  if (chat.phase === 'awaiting_decision') {
    return {
      key: 'chat-decision',
      title: '聊完了，待确认',
      detail: summary.length > 260 ? `${summary.slice(0, 260)}…` : summary,
      primary: { label: '确认结论', action: 'chat-accept' },
      secondary: { label: '再聊一轮', action: 'continue-chat' },
    }
  }
  return {
    key: 'chat-interrupted',
    title: '刚才断了',
    detail: '刚才断了，可以重新开始这一轮。',
    primary: { label: '重新开始', action: 'chat-resume' },
    secondary: null,
  }
}
