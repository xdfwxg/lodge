import { createElement as h } from 'react'
import { ActivityLine, ChatLine, Markdown } from '../message-cards.js'
import { hostLabelOf } from './host.js'

// 共享层只处理两种房型都存在的消息；专属类型由各自的渲染器先接管。

// 房间记录会长期保留；旧版本写下的系统文案只在显示时换成现在的说法。
const LEGACY_SYSTEM_TEXT = {
  '验收命令完成 · exit 0 · 等待独立复核': '验收命令通过 · 等待独立复核',
  '演示房间 · 不写 CONCLUSION.md，不产生 commit': '演示房间 · 不写结论文件，不生成提交记录',
  'commit 失败，详见服务端日志': '提交失败，详见服务端日志',
}
const systemTextOf = text => LEGACY_SYSTEM_TEXT[text] ?? text

export const resolveSeat = (room, byId, message) => (
  byId[message.authorId]
  ?? (message.authorId === 'lodge' ? { id: 'lodge', name: hostLabelOf(room), title: '' } : undefined)
  ?? (message.authorId === 'system' ? { name: '运行时', title: '验收员' } : undefined)
)

export const renderSharedMessage = ({ room, byId, message }) => {
  const seat = resolveSeat(room, byId, message)
  if (message.kind === 'system' || message.kind === 'advisor_advice' || message.kind === 'child_result') {
    return h('div', { key: message.id, className: 'crew-system' }, systemTextOf(message.text))
  }
  if (message.kind === 'activity') return h(ActivityLine, { key: message.id, message })
  if (message.authorId === 'you') {
    return h('div', { key: message.id, className: 'crew-human' },
      h('div', { className: 'bt-ububble' }, h(Markdown, { text: message.text, variant: 'compact' })),
      h('span', { className: 'crew-human-avatar' }, '你'))
  }
  return h(ChatLine, { key: message.id, message, seat })
}
