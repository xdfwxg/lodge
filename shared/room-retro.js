const count = (messages, kind) => messages.filter(message => message.kind === kind).length

const latestText = (messages, kind) => [...messages]
  .reverse()
  .find(message => message.kind === kind && typeof message.text === 'string' && message.text.trim() !== '')
  ?.text.trim() ?? ''

export const retroOf = (room, messages = []) => {
  const items = []
  if (room?.roomType === 'studio') {
    const reworks = count(messages, 'rework')
    if (reworks > 0) {
      const reason = latestText(messages, 'rework')
      items.push({
        kind: 'rework',
        text: `重做 ${reworks} 次${reason === '' ? '' : `：${reason}`}`,
        suggestion: '把这一步的验收写成一条能跑的检查，减少来回解释。',
      })
    }
    const timeouts = count(messages, 'review_timeout')
    if (timeouts > 0) {
      items.push({
        kind: 'timeout',
        text: `复核超时 ${timeouts} 次`,
        suggestion: '给复核留更明确的证据入口，或把阶段拆小。',
      })
    }
    if (room?.autoCheck?.status === 'blocked' || room?.autoCheck?.status === 'limit-reached') {
      items.push({
        kind: 'check',
        text: '自动检查没有通过',
        suggestion: '在派活前先确认这条检查能在工作副本里跑起来。',
      })
    }
  }
  if (room?.roomType === 'chat') {
    const rounds = room?.chat?.round ?? 1
    if (rounds > 1) {
      items.push({
        kind: 'rounds',
        text: `讨论用了 ${rounds} 轮才收敛`,
        suggestion: '下一轮开场先写清判断标准，让分歧更早暴露。',
      })
    }
    if (room?.chat?.turns >= room?.chat?.turnLimit) {
      items.push({
        kind: 'turns',
        text: '讨论用满了发言上限',
        suggestion: '把话题缩成一个可决定的选项，再开新一轮。',
      })
    }
  }
  const trimmed = items.slice(0, 3)
  return {
    mode: room?.roomType ?? '',
    items: trimmed,
    summary: trimmed.length === 0 ? '这次没有明显摩擦' : trimmed.map(item => item.text).join('；'),
  }
}
