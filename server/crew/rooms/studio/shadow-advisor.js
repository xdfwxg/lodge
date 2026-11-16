// 影子评审：advisor 只在房间开启时提供一份对照意见。
// 它不进 Gate、不进验收员提示词、不阻塞验收；意见存在房间状态里，按阶段覆盖，不进 transcript。
const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')

const noticeText = (host, kind) => {
  if (kind === 'unavailable') return '影子评审开着，但 Lodge 没有配置外部 advisor；这次没有外部意见。'
  if (kind === 'consent') {
    return `影子评审需要先确认外部服务${host === '' ? '' : `（${host}）`}：这间房没有记录过向它发送证据和 diff 的确认，这次跳过。`
  }
  return `影子评审已开启：这次复核的证据和 diff 会发给外部 advisor 服务${host === '' ? '' : `（${host}）`}。意见只供你签字前参考，不进入验收判定。`
}

const ensureNotice = ({ store, roomId, kind, host }) => {
  const metaKey = kind === 'privacy' ? 'advisorNotice' : kind === 'unavailable' ? 'advisorUnavailable' : 'advisorConsentNotice'
  const seen = store.readMessages(roomId).some(message => message.meta?.[metaKey] === true)
  if (seen) return
  store.appendMessage(roomId, {
    kind: 'system',
    text: noticeText(host, kind),
    meta: { [metaKey]: true },
  })
}

const reviewPayload = ({ room, stage, evidence, manual }) => {
  const meta = evidence?.meta ?? {}
  return {
    mode: 'review',
    goal: clip(room?.goal, 2000),
    stage: {
      title: clip(stage?.title, 500),
      acceptance: clip(stage?.acceptance, 2000),
      manual: manual === true,
    },
    evidence: {
      id: evidence?.id,
      text: clip(evidence?.text, 4000),
      command: clip(meta.command, 2000),
      exit: meta.exit,
      diff: clip(meta.diff, 8000),
      files: Array.isArray(meta.files) ? meta.files.slice(0, 50) : [],
      // 只给文件名和校验信息，不把文件正文送出去。
      artifacts: Array.isArray(meta.artifacts)
        ? meta.artifacts.slice(0, 50).map(item => ({
          path: clip(item?.path, 500),
          bytes: Number.isFinite(item?.bytes) ? item.bytes : null,
          sha256: clip(item?.sha256, 80),
        }))
        : [],
    },
  }
}

export const recordShadowAdvice = async ({
  store,
  roomId,
  advisor,
  room,
  emit = () => {},
  index,
  stage,
  evidence,
  manual = false,
}) => {
  if (room?.shadowReview !== true) return null
  if (typeof advisor?.advice !== 'function') return null
  const described = advisor.describe?.() ?? { available: advisor.available === true, host: '' }
  if (described.available !== true) {
    ensureNotice({ store, roomId, kind: 'unavailable', host: '' })
    return null
  }
  const host = typeof described.host === 'string' ? described.host : ''
  if (room.advisorConsent?.host !== host) {
    ensureNotice({ store, roomId, kind: 'consent', host })
    return null
  }
  ensureNotice({ store, roomId, kind: 'privacy', host })
  const result = await advisor.advice(reviewPayload({ room, stage, evidence, manual }))
  const lines = Array.isArray(result?.advice) ? result.advice : []
  if (lines.length === 0) return result
  const updated = store.updateRoom(roomId, current => {
    // 证据已经换轮或阶段已经推进时，迟到的意见不再落进房间。
    if (current.stages?.[index]?.state !== 'active') return null
    current.advisorShadow = {
      ...(current.advisorShadow ?? {}),
      [index]: {
        evidenceId: evidence?.id ?? null,
        advice: lines,
        available: result.available === true,
        ...(result.model === undefined ? {} : { model: result.model }),
        ...(result.version === undefined ? {} : { version: result.version }),
        at: Date.now(),
      },
    }
    return { events: [{ type: 'room.advisor_shadow', payload: { stage: index, evidenceId: evidence?.id ?? null } }] }
  })
  if (updated !== null) emit('room', updated)
  return result
}
