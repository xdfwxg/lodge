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
  // 派活正文常把标签加粗；摘要读的是内容，不读 Markdown 记号。
  const plain = String(message.text ?? '').replaceAll('**', '')
  const mention = /@([^\s，,。]+)/.exec(plain)?.[1] ?? ''
  const line = plain.split('\n').find(item => item.includes('验收命令') || item.includes('完成标准')) ?? ''
  const acceptance = /`([^`]+)`/.exec(line)?.[1]?.trim()
    ?? /(?:验收命令|完成标准)[：:]\s*([^\n。]+)/.exec(line)?.[1]?.trim()
    ?? ''
  const stage = /阶段\s*(\d+)/.exec(plain)?.[1] ?? ''
  return { mention, acceptance, stage }
}
