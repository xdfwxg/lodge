import { createElement as h } from 'react'
import { MarkdownText } from './primitives.js'
import { MD, timeOf } from './view-format.js'
import { personalityLabel } from '../../shared/personalities.js'
import { RoleIcon } from './room/role-icon.js'

// 两种房型共用的消息呈现：说话人、正文、活动行。房型专属卡片各自留在 room/<mode>/。

function Markdown({ text, variant, mentions = null }) {
  return h(MarkdownText, { text, labels: MD, variant, mentions })
}

function Speaker({ member, ts, time = true, station = true, persona = '' }) {
  return h('div', { className: 'crew-speaker' },
    member === undefined || member === null ? null : h(RoleIcon, { member }),
    h('span', { className: 'crew-speaker-name' }, member?.name ?? '—'),
    persona === '' ? null : h('span', { className: 'crew-speaker-persona' }, `（${persona}）`),
    station ? h('span', { className: 'crew-speaker-station' }, member?.title ?? '') : null,
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

function ChatTopicText({ text, topic = false, mentions = null }) {
  const parts = topic ? splitTopic(text) : null
  return parts === null
    ? h(Markdown, { text, mentions })
    : h('span', null, parts.before, h('strong', { className: 'crew-chat-topic' }, parts.topic), parts.after)
}

function ChatLine({ message, member, mentions = null }) {
  const streaming = message.meta?.streaming === true
  return h('div', { className: 'crew-msg crew-msg-chat' },
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { member, ts: message.ts, time: false, station: false, persona: personalityLabel(member?.personality) }),
      h('div', {
        className: streaming ? 'bt-bubble crew-streaming' : 'bt-bubble',
      }, h(ChatTopicText, { text: String(message.text ?? ''), topic: message.meta?.opening === true, mentions }))))
}

export { Markdown, Speaker, ActivityLine, ChatLine, ChatTopicText }
