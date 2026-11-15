import { receiptText } from '../../../shared/receipt.js'

// 交接单本身进入工作室指令，目标只留主题；回执与普通结论才展开成文本。
export const seedGoalText = seed => {
  if (seed?.handoff !== null && seed?.handoff !== undefined) {
    const topic = String(seed.handoff.topic ?? '').trim() || String(seed?.goal ?? '').trim()
    return topic.slice(0, 2000)
  }
  const goal = String(seed?.goal ?? '').trim()
  const structured = seed?.receipt ? receiptText(seed.receipt) : ''
  const conclusion = structured !== '' ? structured : String(seed?.conclusion ?? '').trim()
  const label = typeof seed?.label === 'string' && seed.label !== '' ? seed.label : '聊天室结论'
  const text = conclusion === '' ? goal : `${goal}\n\n${label}：\n${conclusion}`
  return text.slice(0, 2000)
}
