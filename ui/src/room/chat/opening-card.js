import { createElement as h } from 'react'
import { ChatTopicText, Speaker } from '../../message-cards.js'

// 聊天室开场和结论共用一套卡片骨架；开场不参与结论的确认动作。
export function ChatOpeningCard({ message, member, room }) {
  const round = message.meta?.round ?? room.chat?.round ?? 1
  // 旧房间的开场白带过「欢迎大家踊跃发言」；展示时一并收口，新回合不再写入。
  const text = String(message.text ?? '').replace(/，?欢迎大家踊跃发言[。！]?$/, '')
  return h('div', { className: 'crew-msg-conclusion crew-msg-chat' },
    h(Speaker, { member, ts: message.ts, time: false, station: false }),
    h('div', { className: 'crew-card crew-opening' },
      h('div', { className: 'crew-card-body' },
        h('b', { className: 'crew-conclusion-title' }, `第 ${round} 轮讨论`),
        h(ChatTopicText, { text, topic: true }))))
}
