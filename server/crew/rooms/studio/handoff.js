import { markSeatRead } from '../../watermarks.js'
import { seatDisplayName, seatHandle, seatMention } from '../../seat-labels.js'
import { buildWorkTurn } from './work-turn.js'



// 接力棒只执行交接：解析 handle、写工作拍、@目标席位、唤醒、记事件。
// 能不能交接由 stage/review 判断，这里不改阶段状态。
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
    const handle = seatHandle(current, to)
    const mention = seatMention(current, to)
    if (mention === '') {
      const text = `接力失败：${seatDisplayName(current, to)} 缺少基座 handle，未发送 @；先检查席位映射。`
      store.appendMessage(roomId, { kind: 'system', text })
      store.appendEvent(roomId, 'handoff.failed', { stage: index, from, to, reason, error: 'missing_handle' })
      throw new Error(text)
    }

    const body = String(prompt ?? '').replace(/^@\S+\s*/, '').trim()
    const targetText = `${mention} ${body}`.trim()
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
    const stored = store.appendMessage(roomId, {
      kind: 'handoff',
      authorId: from,
      text: summary,
      meta: {
        stage: index,
        from,
        to,
        workers: [to],
        targetHandle: handle,
        reason,
        acceptance: acceptance ?? '',
        rework,
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
      handle,
      messageId: stored.id,
    })
    try {
      await sendToSeat(to, targetText)
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
        handle,
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
        handle,
        messageId: stored.id,
        error: String(error?.message ?? error),
      })
      throw error
    }
  }

  return { trigger }
}
