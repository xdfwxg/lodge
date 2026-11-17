import { createElement as h, useState } from 'react'
import { Island } from '../../island.js'
import { TargetIcon } from '../../icons.js'

const STATUS = {
  'chat-running': { label: '正在聊', tone: 'active' },
  'chat-concluded': { label: '聊完了', tone: 'done' },
  'chat-interrupted': { label: '断了', tone: 'paused' },
}

export const chatIslandState = decision => (
  STATUS[decision?.key] ?? {
    label: decision?.title ?? '聊天室',
    tone: decision?.tone ?? 'active',
  }
)

// 聊天室只保留一个动作：断了要重开。结论不确认，继续聊就是发消息。
const ACTIONABLE = new Set(['chat-resume'])
const actionOf = action => ACTIONABLE.has(action) ? action : undefined

export const chatIslandView = ({ decision } = {}) => ({
  ...chatIslandState(decision),
  detail: decision?.detail,
  primary: decision?.primary === undefined || decision?.primary === null || actionOf(decision.primary.action) === undefined
    ? undefined
    : decision.primary,
  secondary: decision?.secondary === undefined || decision?.secondary === null || actionOf(decision.secondary.action) === undefined
    ? undefined
    : decision.secondary,
})

export function ChatIsland({ room, decision, actions = {} }) {
  const view = chatIslandView({ decision })
  const [busy, setBusy] = useState(false)

  const resume = async () => {
    if (busy || typeof actions.resumeChat !== 'function') return
    setBusy(true)
    try {
      await actions.resumeChat()
    } finally {
      setBusy(false)
    }
  }

  const detail = view.detail === undefined
    ? null
    : h('p', { className: 'crew-island-detail-text', title: view.detail }, view.detail)
  const footer = view.primary === undefined
    ? null
    : h('div', { className: 'crew-island-actions' },
      h('button', {
        type: 'button',
        className: 'crew-accept crew-quiet-primary',
        disabled: busy,
        onClick: () => {
          if (view.primary.action === 'chat-resume') void resume()
        },
      }, view.primary.label))

  return h(Island, {
    title: room.name || room.goal || '聊天室',
    status: view.label,
    tone: view.tone,
    icon: h(TargetIcon),
    titleText: room.goal,
    detail,
    footer,
  })
}
