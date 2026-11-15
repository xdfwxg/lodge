import { createElement as h } from 'react'
import { buildIdleDecision, cleanText } from '../decision.js'

const conclusionOf = room => {
  const message = [...(room.messages ?? [])].reverse().find(item => item.kind === 'chat_conclusion')
  return message === undefined ? null : message
}

// 聊天室只关心：讨论中、出结论、已确认、中断；没有阶段和验收。
export const buildChatDecision = room => {
  const idle = buildIdleDecision(room)
  if (idle !== null) return idle
  const chat = room.chat ?? {}
  const conclusion = conclusionOf(room)
  const text = cleanText(conclusion?.text)

  if (room.state === 'complete') {
    return {
      key: 'chat-complete',
      title: '这次聊完了',
      detail: text.length > 260 ? `${text.slice(0, 260)}…` : text,
      primary: null,
      secondary: null,
      extra: { label: '拿结论开工作室', action: 'start-studio' },
    }
  }
  if (chat.running === true) {
    return { key: 'chat-running', title: '正在聊', detail: '成员正在发言', primary: null, secondary: null }
  }
  if (chat.phase === 'awaiting_decision') {
    return {
      key: 'chat-decision',
      title: '聊完了，等你定',
      detail: text.length > 260 ? `${text.slice(0, 260)}…` : text,
      primary: { label: '就这样，收结论', action: 'chat-accept' },
      secondary: { label: '再聊一轮', action: 'continue-chat' },
      extra: { label: '拿结论开工作室', action: 'start-studio' },
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

export function ChatStatusHeader({ room, decision }) {
  return h('header', { className: 'crew-decision-head' },
    h('div', { className: 'crew-decision-heading' },
      h('h1', { title: room.goal }, room.name),
      h('p', { className: 'crew-decision-state', 'data-tone': decision.tone }, decision.title)))
}
