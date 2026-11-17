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
  if (room?.shadowReview !== true) return null
  if (typeof shadow?.ask !== 'function') return null
  const result = await shadow.ask({ room, stage, evidence, manual })
  if (result?.available !== true) {
    ensureNotice({ store, roomId })
    return result
  }
  const lines = Array.isArray(result.advice) ? result.advice : []
  if (lines.length === 0) return result
  const updated = store.updateRoom(roomId, current => {
    // 证据已经换轮或阶段已经推进时，迟到的意见不再落进房间。
    if (current.stages?.[index]?.state !== 'active') return null
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
