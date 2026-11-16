// 房间用展示名，基座用成员名；两者只在跨边界时转换，房间记录仍显示人话。
export const seatDisplayName = (room, seatId) => (
  room?.seatSpecs?.find(seat => seat.id === seatId)?.name ?? seatId
)

// 新房间的基座成员名就是展示名；旧房间可能不同。展示、日志、卡片统一走 seatDisplayName。
export const seatBaseName = (room, seatId) => {
  const name = room?.seatNames?.[seatId]
  return typeof name === 'string' ? name.trim() : ''
}

// 传输层用：席位在基座里的地址是成员名 + 成员引用；缺一个就不能投递。
export const seatAddress = (room, seatId) => {
  const name = seatBaseName(room, seatId)
  const memberRef = room?.seatBots?.[seatId]
  if (name === '' || typeof memberRef !== 'string' || memberRef === '') return null
  return { name, mention: `@${name}`, memberRef }
}

export const hostAddress = room => {
  const name = room?.chatHost?.name
  const memberRef = room?.chatHost?.memberRef
  if (typeof name !== 'string' || name === '' || typeof memberRef !== 'string' || memberRef === '') return null
  return { name, mention: `@${name}`, memberRef }
}

// 只给展示用的成员名映射；seatNames 存的是基座成员名，不参与展示。
export const seatLabelMap = room => Object.fromEntries(
  (room?.seatSpecs ?? []).map(seat => [seat.id, seat.name]),
)

const replaceAll = (text, from, to) => {
  if (typeof text !== 'string' || text === '' || from === '' || from === to) return text
  return text.split(from).join(to)
}

export const LODGE_HOST_LABEL = 'Lodge 主持'

const hostBaseNameOf = room => {
  const name = room?.chatHost?.name
  return typeof name === 'string' && name !== '' ? name : ''
}

const hostDisplayNameOf = room => (
  typeof room?.chatHost?.displayName === 'string' ? room.chatHost.displayName : ''
)

export const toBaseMentions = (room, text) => {
  let output = text
  for (const seat of room?.seatSpecs ?? []) {
    const baseName = room?.seatNames?.[seat.id]
    if (typeof baseName !== 'string' || baseName === '' || baseName === seat.name) continue
    output = replaceAll(output, `@${seat.name}`, `@${baseName}`)
  }
  return output
}

export const toDisplayMentions = (room, text) => {
  let output = text
  for (const seat of room?.seatSpecs ?? []) {
    const baseName = room?.seatNames?.[seat.id]
    if (typeof baseName !== 'string' || baseName === '' || baseName === seat.name) continue
    output = replaceAll(output, `@${baseName}`, `@${seat.name}`)
  }
  const host = hostBaseNameOf(room)
  const label = hostDisplayNameOf(room)
  return host === '' || label === '' ? output : replaceAll(output, `@${host}`, `@${label}`)
}

// 前端看到的文本统一用成员名，连基座反馈里没带 @ 的成员名也换掉。
export const toDisplayText = (room, text) => {
  let output = toDisplayMentions(room, text)
  for (const seat of room?.seatSpecs ?? []) {
    const baseName = room?.seatNames?.[seat.id]
    if (typeof baseName !== 'string' || baseName === '' || baseName === seat.name) continue
    output = replaceAll(output, baseName, seat.name)
  }
  const host = hostBaseNameOf(room)
  const label = hostDisplayNameOf(room)
  return host === '' || label === '' ? output : replaceAll(output, host, label)
}
