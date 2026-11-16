import { normalizeHandoff } from '../../../../shared/handoff.js'

// 聊天结论只作为小屋的交接单；不复制聊天状态、证据或阶段。
export const chatStudioSeed = ({ room, conclusion, handoff }) => {
  const text = String(conclusion ?? '').trim()
  const structured = normalizeHandoff(handoff)
  return {
    goal: structured?.topic || String(room?.goal ?? '').trim(),
    conclusion: text,
    sourceName: String(room?.name ?? '').trim(),
    ...(typeof room?.id === 'string' && room.id !== '' ? { sourceRoomId: room.id } : {}),
    ...(structured === null ? {} : { handoff: structured }),
  }
}
