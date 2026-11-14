// 聊天结论只转成目标文本；不复制聊天状态、证据或阶段。
export const seedGoalText = seed => {
  const goal = String(seed?.goal ?? '').trim()
  const conclusion = String(seed?.conclusion ?? '').trim()
  const text = conclusion === '' ? goal : `${goal}\n\n聊天室结论：\n${conclusion}`
  return text.slice(0, 2000)
}
