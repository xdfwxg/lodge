// 影子评审：advisor 只在房间开启时提供一份对照意见。
// 它不进 Gate、不进验收员提示词、不阻塞验收；证据和 diff 会发给外部服务，所以第一次调用前先留可见提示。
const adviceTextOf = advice => advice
  .map(item => item?.summary ?? [...(item?.reasons ?? []), ...(item?.risks ?? [])].join('；'))
  .filter(Boolean)
  .join('；')

const noticeOf = advisor => {
  const described = advisor?.describe?.() ?? {}
  const host = typeof described.host === 'string' && described.host !== '' ? `（${described.host}）` : ''
  return `影子评审已开启：这次复核的证据和 diff 会发给外部 advisor 服务${host}。意见只供你签字前参考，不进入验收判定。`
}

export const recordShadowAdvice = async ({
  store,
  roomId,
  advisor,
  room,
  index,
  stage,
  evidence,
  manual = false,
}) => {
  if (room?.shadowReview !== true) return null
  const live = advisor?.available === true || advisor?.describe?.().available === true
  if (typeof advisor?.advice !== 'function' || live !== true) return null
  const messages = store.readMessages(roomId)
  if (!messages.some(message => message.meta?.advisorNotice === true)) {
    store.appendMessage(roomId, {
      kind: 'system',
      text: noticeOf(advisor),
      meta: { advisorNotice: true },
    })
  }
  const meta = evidence?.meta ?? {}
  const result = await advisor.advice({
    mode: 'review',
    goal: room.goal,
    stage: { title: stage?.title ?? '', acceptance: stage?.acceptance ?? '', manual },
    evidence: {
      id: evidence?.id,
      text: evidence?.text,
      command: meta.command,
      exit: meta.exit,
      diff: meta.diff,
      files: meta.files,
      artifacts: meta.artifacts,
    },
  })
  const lines = Array.isArray(result?.advice) ? result.advice : []
  if (lines.length === 0) return result
  store.appendMessage(roomId, {
    kind: 'advisor_advice',
    authorId: 'system',
    text: `外部意见（仅供参考）：${adviceTextOf(lines)}`,
    meta: {
      stage: index,
      evidenceId: evidence?.id,
      advice: lines,
      shadow: true,
      available: result.available === true,
      ...(result.model === undefined ? {} : { model: result.model }),
      ...(result.version === undefined ? {} : { version: result.version }),
    },
  })
  return result
}
