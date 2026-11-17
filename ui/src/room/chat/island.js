import { createElement as h, useEffect, useState } from 'react'
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

// 岛只报状态，不放操作；要继续聊，在下面发一句就行。
export const chatIslandView = ({ decision } = {}) => ({
  ...chatIslandState(decision),
  detail: decision?.detail,
})

const SHOWN = new Set(['chat-running', 'chat-concluded', 'chat-interrupted'])

export function ChatIsland({ room, decision }) {
  const view = chatIslandView({ decision })
  const [visible, setVisible] = useState(() => SHOWN.has(decision?.key))
  // 岛只在状态变化时浮一下，说完就淡出。
  useEffect(() => {
    const key = decision?.key
    if (!SHOWN.has(key)) {
      setVisible(false)
      return undefined
    }
    setVisible(true)
    const timer = setTimeout(() => setVisible(false), 2600)
    return () => clearTimeout(timer)
  }, [decision?.key, room.id])

  if (!visible) return null
  const detail = view.detail === undefined
    ? null
    : h('p', { className: 'crew-island-detail-text', title: view.detail }, view.detail)

  return h(Island, {
    title: room.name || room.goal || '聊天室',
    status: view.label,
    tone: view.tone,
    icon: h(TargetIcon),
    titleText: room.goal,
    detail,
  })
}
