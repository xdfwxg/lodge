import { createElement as h } from 'react'
import { MarkdownText } from './primitives.js'
import { MD, timeOf } from './view-format.js'

// 两种房型共用的消息呈现：说话人、正文、活动行。房型专属卡片各自留在 room/<mode>/。

function Markdown({ text, variant }) {
  return h(MarkdownText, { text, labels: MD, variant })
}

function Speaker({ seat, ts, time = true, station = true }) {
  return h('div', { className: 'crew-speaker' },
    h('span', { className: 'crew-speaker-name' }, seat?.name ?? '—'),
    station ? h('span', { className: 'crew-speaker-station' }, seat?.title ?? '') : null,
    time ? h('span', { className: 'crew-speaker-time' }, timeOf(ts)) : null)
}

function ActivityLine({ message }) {
  return h('div', { className: 'crew-activity', 'data-ok': message.meta?.ok !== false },
    h('span', { className: 'crew-activity-dot' }),
    h('span', { className: 'crew-activity-text' }, message.text),
    h('span', { className: 'crew-activity-time' }, timeOf(message.ts)))
}

const splitTopic = text => {
  const match = text.match(/^(.*?)【([^】]*)】(.*)$/s)
  return match === null ? null : { before: match[1], topic: match[2], after: match[3] }
}

function ChatLine({ message, seat }) {
  const streaming = message.meta?.streaming === true
  const text = String(message.text ?? '')
  const topic = message.meta?.opening === true ? splitTopic(text) : null
  return h('div', { className: 'crew-msg crew-msg-chat' },
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts, time: false, station: false }),
      h('div', {
        className: streaming ? 'bt-bubble crew-streaming' : 'bt-bubble',
      }, topic === null
        ? h(Markdown, { text })
        : h('span', null, topic.before, h('strong', { className: 'crew-chat-topic' }, topic.topic), topic.after))))
}

export { Markdown, Speaker, ActivityLine, ChatLine }
