import { handoffGoalText } from '../../../shared/handoff.js'

// 聊天结论只转成目标文本；结构化交接单优先，不复制聊天状态、证据或阶段。
export const seedGoalText = seed => {
  if (seed?.handoff !== null && seed?.handoff !== undefined) {
    return handoffGoalText(seed.handoff).slice(0, 2000)
  }
  const goal = String(seed?.goal ?? '').trim()
  const conclusion = String(seed?.conclusion ?? '').trim()
  const label = typeof seed?.label === 'string' && seed.label !== '' ? seed.label : '聊天室结论'
  const text = conclusion === '' ? goal : `${goal}\n\n${label}：\n${conclusion}`
  return text.slice(0, 2000)
}
