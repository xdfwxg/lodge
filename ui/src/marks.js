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
  }, h('span', { className: 'crew-mark-face' }, initialOf(name, 'C')))
}

export function BotAvatar({ bot, size = 30, live = false }) {
  return h('span', { className: 'crew-avatar', style: { width: size, height: size } },
    h(BotMark, { bot, size, live }),
    live ? h('span', { className: 'crew-avatar-dot' }) : null)
}

export function RoomAvatar({ room, roster, size = 36 }) {
  const members = (room.members ?? []).map(id => roster.byId[id]).filter(Boolean)
  if (members.length === 0) return h(BotMark, { size })
  if (members.length === 1) return h(BotMark, { bot: members[0], size })
  const seat = Math.round(size * 0.62)
  const shown = members.slice(0, 3)
  const rest = members.length - shown.length
  return h('span', { className: 'crew-cluster', style: { width: size, height: size } },
    shown.map((bot, index) => h('span', {
      key: bot.id,
      className: 'crew-cluster-seat',
      style: { left: index * (size - seat) / Math.max(1, shown.length - 1), top: index % 2 === 0 ? 0 : size - seat },
    }, h(BotMark, { bot, size: seat }))),
    rest > 0 ? h('span', { className: 'crew-cluster-more', style: { fontSize: Math.max(8, Math.round(size * 0.28)) } }, `+${rest}`) : null)
}
