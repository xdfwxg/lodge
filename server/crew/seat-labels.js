// 界面用角色名，基座用真实 handle；只在跨边界时转换，房间记录仍显示人话。
export const seatDisplayName = (room, seatId) => (
  room?.seatSpecs?.find(seat => seat.id === seatId)?.name ??
  room?.seatNames?.[seatId] ??
  seatId
)

// 只给展示用的席位名映射；seatNames 存的是基座 handle，只在缺 seatSpecs 时兜底。
export const seatLabelMap = room => {
  const ids = new Set([
    ...(room?.seatSpecs ?? []).map(seat => seat.id),
    ...Object.keys(room?.seatNames ?? {}),
  ])
  return Object.fromEntries([...ids].map(id => [id, seatDisplayName(room, id)]))
}

const replaceAll = (text, from, to) => {
  if (typeof text !== 'string' || text === '' || from === '' || from === to) return text
  return text.split(from).join(to)
}

export const LODGE_HOST_LABEL = 'Lodge 主持'

const hostHandleOf = room => {
  const name = room?.chatHost?.name
  return typeof name === 'string' && name !== '' ? name : ''
}

// 主持人的显示名随房间记录走；旧房间没有 displayName 时退回统一标签。
const hostLabelOf = room => {
  const label = room?.chatHost?.displayName
  return typeof label === 'string' && label !== '' ? label : LODGE_HOST_LABEL
}

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
  return host === '' ? output : replaceAll(output, `@${host}`, `@${hostLabelOf(room)}`)
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
  return host === '' ? output : replaceAll(output, host, hostLabelOf(room))
}

