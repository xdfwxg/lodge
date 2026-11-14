// 聊天结论只作为新建工作室的目标文本；不复制聊天状态、证据或阶段。
export const chatStudioSeed = ({ room, conclusion }) => ({
  goal: String(room?.goal ?? '').trim(),
  conclusion: String(conclusion ?? '').trim(),
  sourceName: String(room?.name ?? '').trim(),
})
