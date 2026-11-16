import { createHash } from 'node:crypto'
import { markSeatRead } from '../../watermarks.js'
import { seatDisplayName } from '../../seat-labels.js'
import { buildWorkTurn } from './work-turn.js'

const deliveryId = ({ index, from, to, reason, acceptance, evidence, candidate, rework }) => (
  `h-${createHash('sha256')
    .update(JSON.stringify({
      index,
      from,
      to,
      reason,
      acceptance,
      evidenceId: evidence?.id ?? '',
      candidate: candidate ?? '',
      rework,
    }))
    .digest('hex')
    .slice(0, 32)}`
)

// 接力棒只执行交接：写工作拍、交给目标席位、记事件。
// 地址由传输层解析；能不能交接由 stage/review 判断，这里不改阶段状态。
export const createHandoff = ({ store, roomId, sendToSeat, emit }) => {
  const trigger = async ({
    room,
    stage,
    index,
    from,
    to,
    reason,
    prompt,
    acceptance,
    evidence = null,
    verdict = null,
    candidate = null,
    rework = false,
  }) => {
    const current = store.readRoom(roomId) ?? room
    const body = String(prompt ?? '').replace(/^@\S+\s*/, '').trim()
    const targetText = body
    const label = seatDisplayName(current, to)
    const summary = `阶段 ${index + 1}${stage?.title ? `「${stage.title}」` : ''}接力 → ${label}${acceptance ? ` · 验收 ${acceptance}` : ''}`
    const workTurn = buildWorkTurn({
      room: current,
      stage,
      index,
      from,
      to,
      reason,
      acceptance,
      evidence,
      verdict,
      candidate,
    })
    const sendId = deliveryId({ index, from, to, reason, acceptance, evidence, candidate, rework })
    const stored = store.appendMessage(roomId, {
      kind: 'handoff',
      authorId: from,
      text: summary,
      meta: {
        stage: index,
        from,
        to,
        workers: [to],
        reason,
        acceptance: acceptance ?? '',
        rework,
        deliveryId: sendId,
        status: 'sending',
        workTurn,
      },
    })
    markSeatRead({ store, roomId, seat: to, emit })
    store.appendEvent(roomId, 'handoff.requested', {
      stage: index,
      from,
      to,
      reason,
      messageId: stored.id,
    })
    try {
      await sendToSeat(to, targetText, {
        intent: reason === 'review' ? 'review' : 'handoff',
        from,
        sendId,
      })
      const sent = {
        ...stored,
        meta: { ...stored.meta, status: 'sent', sentAt: Date.now() },
      }
      store.upsertMessage?.(sent)
      store.appendEvent(roomId, 'handoff.sent', {
        stage: index,
        from,
        to,
        reason,
        messageId: stored.id,
      })
      return sent
    } catch (error) {
      const failed = {
        ...stored,
        meta: { ...stored.meta, status: 'failed', error: String(error?.message ?? error) },
      }
      store.upsertMessage?.(failed)
      store.appendEvent(roomId, 'handoff.failed', {
        stage: index,
        from,
        to,
        reason,
        messageId: stored.id,
        error: String(error?.message ?? error),
      })
      throw error
    }
  }

  return { trigger }
}
