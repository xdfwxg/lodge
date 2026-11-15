import { parseHandoffFromText } from '../../../../shared/handoff.js'

// 聊天结论只作为小屋的交接单；不复制聊天状态、证据或阶段。
export const chatStudioSeed = ({ room, conclusion, handoff }) => {
  const text = String(conclusion ?? '').trim()
  // 解析器是交接单的最终口径；模型或旧记录里的 handoff 只做兜底。
  const structured = parseHandoffFromText(text, room?.goal) ?? handoff ?? null
  return {
    goal: structured?.topic || String(room?.goal ?? '').trim(),
    conclusion: text,
    sourceName: String(room?.name ?? '').trim(),
    ...(structured === null ? {} : { handoff: structured }),
  }
}
