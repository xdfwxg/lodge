const money = micro => {
  const usd = (Number(micro) || 0) / 1_000_000
  return usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`
}

const usageText = usage => {
  if (usage === null || usage === undefined) return ''
  const turns = Number(usage.turns) || 0
  if (turns === 0) return ''
  const cost = usage.costStatus === 'unknown'
    ? '费用未知'
    : usage.costStatus === 'partial' ? `至少 ${money(usage.costMicroUsd)}` : money(usage.costMicroUsd)
  return `${turns} 轮 · ${cost}`
}

export const runMetricsOf = room => {
  const stages = Array.isArray(room?.stages) ? room.stages : []
  const index = stages.findIndex(stage => stage.state === 'active')
  if (index < 0) return null
  const messages = Array.isArray(room?.messages) ? room.messages : []
  const stageOf = message => message?.meta?.stage
  const reworks = messages.filter(message => message.kind === 'rework' && stageOf(message) === index).length
  const human = messages.filter(message => message.kind === 'human-context' && stageOf(message) === index).length
  return {
    usage: usageText(room?.usage),
    reworks,
    human,
    memoryCount: Array.isArray(room?.sharedMemory) ? room.sharedMemory.length : 0,
  }
}

const firstLine = text => String(text ?? '').split('\n').map(line => line.trim()).find(Boolean) ?? ''
const clip = (text, max = 40) => {
  const chars = [...String(text ?? '').trim()]
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
}

// 工具名不是用户语言；把“读了什么、改了什么、跑了什么”说成一句中文动作。
export const toolLabelOf = message => {
  const meta = message?.meta ?? {}
  const action = String(meta.action ?? '')
  const target = String(meta.target ?? '').trim()
  const detail = firstLine(meta.detail).replace(/^cd\s+\S+\s+/, '').replace(/^(?:&&|\|\||;)\s*/, '').trim()
  if (action === 'read') return target === '' ? '读了一个文件' : `读了 ${clip(target, 32)}`
  if (action === 'write') return target === '' ? '改了文件' : `改了 ${clip(target, 32)}`
  if (action === 'exec') {
    if (detail !== '') return `跑了 ${clip(detail, 36)}`
    if (target !== '') return `跑了 ${clip(target, 32)}`
    return '跑了一条命令'
  }
  if (action === 'gate') return '提交了判定'
  const raw = String(message.text ?? '').trim()
  // 基座把「XX 的 recent-work brief」塞进工具名；翻成一句中文，不露英文。
  if (/recent-work brief/i.test(raw)) return '翻看了最近的工作'
  return clip(raw || '工具', 24)
}
