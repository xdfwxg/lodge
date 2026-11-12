import { createElement as h } from 'react'

// 席位与房间头像：Lodge 自己的实现，不依赖 vendored UI 的角色系统。
const PALETTE = {
  planner: '#4d6bfe',
  executor: '#00a86b',
  verifier: '#c26a00',
  you: '#070707',
}
const FALLBACK = ['#4d6bfe', '#00a86b', '#c26a00', '#8b5cf6', '#0891b2', '#d946ef']

const hash = text => {
  let value = 0
  for (const char of String(text)) value = (value * 31 + char.codePointAt(0)) >>> 0
  return value
}

const colorOf = key => PALETTE[key] ?? FALLBACK[hash(key) % FALLBACK.length]

const initialOf = (text, fallback) => {
  const chars = Array.from(String(text ?? '').trim())
  return chars.length === 0 ? fallback : chars[0].toUpperCase()
}

export function BotMark({ bot, size = 36, live = false, label }) {
  const key = bot?.id ?? label ?? 'crew'
  const name = label ?? bot?.name ?? ''
  const color = colorOf(key)
  return h('span', {
    className: 'crew-mark',
    'data-live': live ? 'true' : undefined,
    style: { width: size, height: size, '--crew-mark-color': color, fontSize: Math.round(size * 0.44) },
  }, h('span', { className: 'crew-mark-face' }, initialOf(name, 'L')))
}

export function BotAvatar({ bot, size = 30, live = false }) {
  return h('span', { className: 'crew-avatar', style: { width: size, height: size } },
    h(BotMark, { bot, size, live }),
    live ? h('span', { className: 'crew-avatar-dot' }) : null)
}

export function RoomMark({ room, size = 36 }) {
  return h('span', {
    className: 'crew-room-mark',
    style: { width: size, height: size, fontSize: Math.round(size * 0.4) },
  }, initialOf(room?.name, '房'))
}
