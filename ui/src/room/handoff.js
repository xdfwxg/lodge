// 规划师的长派活消息是编排记录，不是聊天内容；主时间线只留一条摘要。
export const isDispatchHandoff = (room, message) => {
  if (room?.roomType !== 'studio') return false
  if (message?.kind !== 'chat' || message.authorId !== room.leadSeat) return false
  const text = String(message.text ?? '')
  return /^@[^\s，,。]+/.test(text.trim()) &&
    text.includes('工作目录') &&
    (text.includes('验收命令') || text.includes('完成标准'))
}

export const dispatchSummaryOf = message => {
  const text = String(message.text ?? '')
  const mention = /@([^\s，,。]+)/.exec(text)?.[1] ?? ''
  const acceptance = /验收命令[：:\s]*`?([^`\n。]+)`?/.exec(text)?.[1]?.trim() ?? ''
  const stage = /阶段\s*(\d+)/.exec(text)?.[1] ?? ''
  return { mention, acceptance, stage }
}
