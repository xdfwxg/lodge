// 界面用角色名，基座用真实 handle；只在跨边界时转换，房间记录仍显示人话。
export const seatDisplayName = (room, seatId) => (
  room?.seatSpecs?.find(seat => seat.id === seatId)?.name ??
  room?.seatNames?.[seatId] ??
  seatId
)

const replaceAll = (text, from, to) => {
  if (typeof text !== 'string' || text === '' || from === '' || from === to) return text
  return text.split(from).join(to)
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
  return output
}

// 前端看到的文本统一用角色名，连基座反馈里没带 @ 的 handle 也换掉。
export const toDisplayText = (room, text) => {
  let output = toDisplayMentions(room, text)
  for (const seat of room?.seatSpecs ?? []) {
    const handle = room?.seatNames?.[seat.id]
    if (typeof handle !== 'string' || handle === '' || handle === seat.name) continue
    output = replaceAll(output, handle, seat.name)
  }
  return output
}

