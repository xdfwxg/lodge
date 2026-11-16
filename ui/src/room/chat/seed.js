import { handoffOf } from '../../../../shared/handoff.js'

// 聊天结论只作为小屋的交接单；不复制聊天状态、证据或阶段。
export const chatStudioSeed = ({ room, conclusion, handoff }) => {
  const text = String(conclusion ?? '').trim()
  // 已经存下来的 handoff 是最终口径；没有时才解析旧文本。
  const structured = handoffOf({ handoff, text, fallbackTopic: room?.goal })
  return {
    goal: structured?.topic || String(room?.goal ?? '').trim(),
    conclusion: text,
    sourceName: String(room?.name ?? '').trim(),
    ...(typeof room?.id === 'string' && room.id !== '' ? { sourceRoomId: room.id } : {}),
    ...(structured === null ? {} : { handoff: structured }),
  }
}
