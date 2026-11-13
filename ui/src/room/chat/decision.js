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
      title: '聊天已结束',
      detail: text.length > 260 ? `${text.slice(0, 260)}…` : text,
      primary: null,
      secondary: { label: '查看完整记录', action: 'audit' },
      extra: { label: '用结论新建工作室', action: 'start-studio' },
    }
  }
  if (chat.running === true) {
    return { key: 'chat-running', title: '讨论中', detail: '成员正在发言', primary: null, secondary: null }
  }
  if (chat.phase === 'awaiting_decision') {
    return {
      key: 'chat-decision',
      title: '讨论结束，等你确认结论',
      detail: text.length > 260 ? `${text.slice(0, 260)}…` : text,
      primary: { label: '确认结论', action: 'chat-accept' },
      secondary: { label: '再讨论', action: 'continue-chat' },
      extra: { label: '用结论新建工作室', action: 'start-studio' },
    }
  }
  return {
    key: 'chat-interrupted',
    title: '讨论中断，等你处理',
    detail: '上一轮讨论中断了，可以重新开始本轮。',
    primary: { label: '重新开始讨论', action: 'chat-resume' },
    secondary: { label: '审计详情', action: 'audit' },
  }
}

export function ChatStatusHeader({ room, decision, onAudit, actions = {} }) {
  const more = [
    room.state === 'active' && actions.pause
      ? { key: 'pause', label: '暂停', run: actions.pause }
      : null,
    room.state === 'paused' && actions.resume
      ? { key: 'resume', label: '继续', run: actions.resume }
      : null,
    ['active', 'paused'].includes(room.state) && actions.stop
      ? { key: 'stop', label: '停止', run: actions.stop }
      : null,
    actions.continue ? { key: 'continue', label: '基于此记录续做', run: actions.continue } : null,
    actions.review ? { key: 'review', label: '复盘', run: actions.review } : null,
  ].filter(Boolean)
  const showActions = typeof onAudit === 'function' || more.length > 0
  return h('header', { className: 'crew-decision-head' },
    h('div', { className: 'crew-decision-heading' },
      h('h1', { title: room.goal }, room.name),
      h('p', { className: 'crew-decision-state', 'data-tone': decision.tone }, decision.title)),
    showActions
      ? h('div', { className: 'crew-decision-head-actions' },
        typeof onAudit === 'function'
          ? h('button', { type: 'button', className: 'crew-ghost', onClick: onAudit }, '审计详情')
          : null,
        more.length > 0
          ? h('details', { className: 'crew-decision-more' },
            h('summary', { 'aria-label': '更多操作' }, '⋯'),
            h('div', { className: 'crew-decision-menu' },
              more.map(item => h('button', { key: item.key, type: 'button', onClick: item.run }, item.label))))
          : null)
      : null)
}
