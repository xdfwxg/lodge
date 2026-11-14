// 界面用角色名，基座用真实 handle；只在跨边界时转换，房间记录仍显示人话。
export const seatDisplayName = (room, seatId) => (
  room?.seatSpecs?.find(seat => seat.id === seatId)?.name ?? seatId
)

// 基座 handle 只在跨边界时使用；展示、日志、卡片统一走 seatDisplayName。
export const seatHandle = (room, seatId) => {
  const handle = room?.seatNames?.[seatId]
  return typeof handle === 'string' ? handle.trim() : ''
}

export const seatMention = (room, seatId) => {
  const handle = seatHandle(room, seatId)
  return handle === '' ? '' : `@${handle}`
}

// 只给展示用的席位名映射；seatNames 存的是基座 handle，不参与展示。
export const seatLabelMap = room => Object.fromEntries(
  (room?.seatSpecs ?? []).map(seat => [seat.id, seat.name]),
)

const replaceAll = (text, from, to) => {
  if (typeof text !== 'string' || text === '' || from === '' || from === to) return text
  return text.split(from).join(to)
}

export const LODGE_HOST_LABEL = 'Lodge 主持'

const hostHandleOf = room => {
  const name = room?.chatHost?.name
  return typeof name === 'string' && name !== '' ? name : ''
}

const hostLabelOf = room => (
  typeof room?.chatHost?.displayName === 'string' ? room.chatHost.displayName : ''
)

export const toBaseMentions = (room, text) => {
  let output = text
  for (const seat of room?.seatSpecs ?? []) {
    const handle = room?.seatNames?.[seat.id]
    if (typeof handle !== 'string' || handle === '' || handle === seat.name) continue
    output = replaceAll(output, `@${seat.name}`, `@${handle}`)
  }
  return output
}

export const toDisplayMentions = (room, text) => {
  let output = text
  for (const seat of room?.seatSpecs ?? []) {
    const handle = room?.seatNames?.[seat.id]
    if (typeof handle !== 'string' || handle === '' || handle === seat.name) continue
    output = replaceAll(output, `@${handle}`, `@${seat.name}`)
  }
  const host = hostHandleOf(room)
  const label = hostLabelOf(room)
  return host === '' || label === '' ? output : replaceAll(output, `@${host}`, `@${label}`)
}

// 前端看到的文本统一用角色名，连基座反馈里没带 @ 的 handle 也换掉。
export const toDisplayText = (room, text) => {
  let output = toDisplayMentions(room, text)
  for (const seat of room?.seatSpecs ?? []) {
    const handle = room?.seatNames?.[seat.id]
    if (typeof handle !== 'string' || handle === '' || handle === seat.name) continue
    output = replaceAll(output, handle, seat.name)
  }
  const host = hostHandleOf(room)
  const label = hostLabelOf(room)
  return host === '' || label === '' ? output : replaceAll(output, host, label)
}

