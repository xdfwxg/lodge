import { createElement as h } from 'react'
import { ChatTopicText, Speaker } from '../../message-cards.js'

// 聊天室开场和结论共用一套卡片骨架；开场不参与结论的确认动作。
// 开场的正文本身就是“今晚请到谁”，不再另加一个说不通的“话题：”标题。
export function ChatOpeningCard({ message, member }) {
  const text = String(message.text ?? '')
  return h('div', { className: 'crew-msg-conclusion crew-msg-chat' },
    h(Speaker, { member, ts: message.ts, time: false, station: false }),
    h('div', { className: 'crew-card crew-opening' },
      h('div', { className: 'crew-card-body' },
        h(ChatTopicText, { text, topic: true }))))
}
