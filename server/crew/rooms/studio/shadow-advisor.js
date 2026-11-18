// 影子评审：房间开启时，一个隐藏的评审成员换一个角度给一份对照意见。
// 它不进 Gate、不进验收员提示词、不阻塞验收；意见存在房间状态里，按阶段覆盖，不进 transcript。
const ensureNotice = ({ store, roomId }) => {
  const seen = store.readMessages(roomId).some(message => message.meta?.advisorFailed === true)
  if (seen) return
  store.appendMessage(roomId, {
    kind: 'system',
    text: '影子评审这次没取到；验收不受影响。',
    meta: { advisorFailed: true },
  })
}

export const recordShadowAdvice = async ({
  store,
  roomId,
  shadow,
  room,
  emit = () => {},
  index,
  stage,
  evidence,
  manual = false,
}) => {
  if (typeof shadow?.ask !== 'function') return null
  const result = await shadow.ask({ room, stage, evidence, manual })
  if (result?.available !== true) {
    ensureNotice({ store, roomId })
    return result
  }
  const lines = Array.isArray(result.advice) ? result.advice : []
  if (lines.length === 0) return result
  const updated = store.updateRoom(roomId, current => {
    // 意见可能比验收慢；只要阶段还在，就挂到该阶段的证据上。界面按 evidenceId 匹配，不会串到别的证据。
    if (current.stages?.[index] === undefined) return null
    current.advisorShadow = {
      ...(current.advisorShadow ?? {}),
      [index]: {
        evidenceId: evidence?.id ?? null,
        advice: lines,
        available: true,
        at: Date.now(),
      },
    }
    return { events: [{ type: 'room.advisor_shadow', payload: { stage: index, evidenceId: evidence?.id ?? null } }] }
  })
  if (updated !== null) emit('room', updated)
  return result
}
