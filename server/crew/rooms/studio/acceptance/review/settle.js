import { INTERNAL_PROMPT_MARKER } from '../../../../internal-prompts.js'
import { appendHandoffProjection } from '../../runtime/projection.js'
import { DECISION_JSON_HINT } from '../../../../../../shared/judgment.js'
import { sanitizeUntrusted } from '../../../../../../shared/untrusted-text.js'
import { leadMemberOf, workerIds } from '../../../../room-members.js'
import { latestDispatchAssignment, transitionAssignment } from '../../../../assignments.js'
import { memberDisplayName } from '../../../../member-labels.js'
import { relayAfterVerdict } from '../../delivery/relay.js'
import { ASSIGNMENT_STATUS, ROOM_STATE } from '../../../../../../shared/states.js'
import { hasLaterWorkStage } from '../review-policy.js'
import { systemNotice } from '../../../../notices.js'

// 一票落下之后，这一轮复核去哪：人还没凑齐就等；凑齐了通过就进下一步/交付，退回就派返工或交给人。
// 平台在这里只做一次裁决，其余地方（发起、单票、计时）都已经把事实写好。
export const settleReview = ({
  store,
  roomId,
  session,
  room,
  pending,
  judgment,
  gate,
  turn,
  name,
  pass,
  verdictMessage,
  reviewAssignment = undefined,
  advanceStage = null,
  handoffTrigger,
}) => {
  const round = session.current()
  const passed = round.passed ?? 0
  const rejected = round.rejects ?? 0
  const required = round.required ?? round.total
  const reachedQuorum = passed >= required
  const impossible = rejected > round.total - required
  const waiting = session.waiting()
  const settled = reachedQuorum || impossible || waiting.length === 0

  if (!settled) {
    store.appendMessage(roomId, {
      kind: 'system',
      text: `${name} ${pass ? '通过' : '退回'}；还有 ${waiting.length} 位验收员在看。`,
    })
    return true
  }

  for (const [remainingMember, request] of round.requests) {
    session.clearTimers(request)
    // 这一轮已经不需要它的意见了：交接也要一起收口。
    // 只清定时器会把复核交接永远留在进行中，整轮到最后一格也结不了。
    if (remainingMember !== pending.verifier && request.assignment?.id !== undefined && request.assignment?.id !== null) {
      transitionAssignment(store, request.assignment.id, ASSIGNMENT_STATUS.cancelled, {
        resultText: reachedQuorum ? '验收意见已经够了' : '验收意见不可能凑齐了',
      })
    }
    store.appendEvent(roomId, 'review.cancelled', {
      stage: pending.stage,
      verifier: remainingMember,
      reason: reachedQuorum ? '验收意见已经够了' : '验收意见不可能凑齐了',
    })
  }
  round.requests.clear()
  const total = round.total
  session.end()

  if (reachedQuorum) {
    // 通过就是进展：复核等待期间可能已被“无进展”暂停，不能让一条通过的判定落在暂停的房间里。
    resumePausedForReviewPass(store, roomId)
    store.appendEvent(roomId, 'review.passed', { stage: pending.stage, verifier: pending.verifier, passed, total })
    const current = store.readRoom(roomId) ?? room
    const later = hasLaterWorkStage(current, pending.stage)
    // 自动交付只看判定是否过了同一套检查：覆盖、证明、反例、diff 外风险；
    // 工具不可用时的文本判定走同一套检查，不再因为换了入口就降级。
    const roundDelivers = current.autoDeliver === true || current.workRound?.autoDeliver === true
    const autoDeliver = !later && roundDelivers && typeof advanceStage === 'function'
    if ((later || autoDeliver) && typeof advanceStage === 'function') {
      // 中间步骤自动过；房间开了自动交付时，最后一步也不等人点确认。
      void Promise.resolve(advanceStage(roomId, pending.stage, { by: 'system', auto: autoDeliver })).then(result => {
        if (result?.ok === false) {
          store.appendMessage(roomId, {
            kind: 'system',
            text: autoDeliver
              ? `这一步验收通过了，但没能自动交付：${result.error ?? '待处理'}。`
              : `这一步验收通过了，但没能自动进入下一步：${result.error ?? '待处理'}。`,
          })
        }
      }).catch(error => {
        systemNotice({
          store,
          roomId,
          text: autoDeliver ? '这一步验收通过了，但没能自动交付；待处理。' : '这一步验收通过了，但没能自动进入下一步；待处理。',
          error,
        })
      })
      return true
    }
    const passLead = leadMemberOf(room)?.id
    appendHandoffProjection({
      store,
      roomId,
      room,
      from: pending.verifier,
      targets: [passLead],
      message: to => `全部验收员通过；@${to.map(id => memberDisplayName(room, id)).join('、@')} 收尾。`,
      // 收尾也是一次交接：让时间线看见验收员把结果交给规划师，别让它像凭空说话。
      meta: {
        stage: pending.stage,
        reason: 'summary',
        // 一次验收轮次一条收尾；返工后再过也要有自己的一条。
        dedupeKey: `summary:${pending.stage}:${pending.evidenceId ?? ''}:${passLead ?? ''}`,
      },
    })
    const lead = leadMemberOf(room)?.id
    if (typeof lead === 'string' && lead !== '') {
      const stage = room.stages?.[pending.stage]
      const stageTitle = stage?.title ?? ''
      // 收尾也是一次成员之间的交接：验收员把结果交给规划师。
      void handoffTrigger({
        room,
        stage,
        index: pending.stage,
        from: pending.verifier,
        to: lead,
        reason: 'summary',
        prompt: [
          `第 ${pending.stage + 1} 步「${stageTitle}」验收通过。`,
          '请在群里用两三句话总结这一步的结果和下一步；不要改文件，也不要再派活。',
          INTERNAL_PROMPT_MARKER,
        ].join('\n'),
        parentAssignmentId: reviewAssignment?.id ?? null,
        nonce: String(pending.evidenceId ?? pending.verifier),
      }).catch(error => {
        systemNotice({ store, roomId, text: '没能叫规划师收尾；这一步仍等你确认。', error })
      })
    }
  } else {
    const stage = room.stages?.[pending.stage]
    const stageTitle = stage?.title ?? ''
    const reason = String(
      judgment.platformRejected === 'proof'
        ? judgment.reason
        : gate === null ? (turn.reply ?? '') : judgment.reason,
    ).trim().slice(0, 300)
    const targets = (Array.isArray(stage?.assignees) ? stage.assignees : [])
      .filter(id => workerIds(room).includes(id))
    const workers = targets.length > 0 ? targets : workerIds(room)
    const reworksUsed = store.readMessages(roomId).filter(message => (
      message.kind === 'rework' && (message.meta?.stage ?? 0) === pending.stage
    )).length
    const relay = relayAfterVerdict({
      pass: false,
      reworksUsed,
      mergeConflict: room.mergeConflict?.stage === pending.stage,
      targets: workers,
    })
    if (relay.kind === 'rework') {
      // 验收员直接交回执行官；规划师不转达退回，只在最后收尾。
      store.appendEvent(roomId, 'review.rework_routed', {
        stage: pending.stage,
        verifier: pending.verifier,
        targets: relay.targets,
        reworksUsed,
      })
      const parallel = relay.targets.length > 1
      const note = reason === '' ? '按验收意见重做这一步。' : reason
      // 返工账本要留下这一笔：预算计数和后续复核的 floor 都只认 rework。
      const reworkNote = store.appendMessage(roomId, {
        kind: 'rework',
        authorId: 'system',
        text: '验收退回，执行官重做。',
        meta: {
          stage: pending.stage,
          // 平台亲手跑出来的拒收（证明跑不起来、反例跑红）记在平台名下，不写成验收员的判定。
          source: typeof judgment.platformRejected === 'string' && judgment.platformRejected !== '' ? 'platform' : 'verifier',
          note,
          verdictId: verdictMessage.id,
        },
      })
      const deliveries = relay.targets.map(target => {
        const parent = latestDispatchAssignment(store, roomId, pending.stage, target)
        if (parent !== null) {
          transitionAssignment(store, parent.id, 'failed', { resultText: '验收退回，执行官重做' })
        }
        return handoffTrigger({
          room,
          stage,
          index: pending.stage,
          from: pending.verifier,
          to: target,
          reason: 'rework',
          prompt: `${sanitizeUntrusted(note, 2000)}\n${INTERNAL_PROMPT_MARKER}`,
          ...(parallel ? { privateRoom: true } : {}),
          rework: true,
          parentAssignmentId: parent?.id ?? null,
          nonce: reworkNote?.id ?? verdictMessage.id,
        }).then(() => target).catch(error => {
          systemNotice({ store, roomId, text: `重做没能交给${memberDisplayName(room, target)}；待处理。`, error })
          return null
        })
      })
      // 只 @ 真正收到重做任务的人：先送，再投影。
      void Promise.all(deliveries).then(delivered => {
        const targets = delivered.filter(Boolean)
        if (targets.length === 0) return
        appendHandoffProjection({
          store,
          roomId,
          room,
          from: pending.verifier,
          targets,
          message: to => `@${to.map(target => memberDisplayName(room, target)).join('、@')} 验收退回，按上面的意见重做第 ${pending.stage + 1} 步。`,
          meta: {
            stage: pending.stage,
            reason: 'rework',
            dedupeKey: `rework:${pending.stage}:${reworkNote?.id ?? verdictMessage.id}:${targets.join(',')}`,
          },
        })
      })
    } else {
      const lead = leadMemberOf(room)?.id
      if (typeof lead === 'string' && lead !== '') {
        // 只有重做预算用完、合并冲突或没有可执行官时才回到规划师/人。
        void handoffTrigger({
          room,
          stage,
          index: pending.stage,
          from: pending.verifier,
          to: lead,
          reason: 'decision',
          prompt: [
            `验收员退回了第 ${pending.stage + 1} 步「${stageTitle}」。`,
            `判定：${reason === '' ? '未通过' : sanitizeUntrusted(reason, 300)}`,
            '判定必须先用工具提交，不要在回复里只写结论：',
            '1. 调用 lodge_gate_submit_decision（基座可能显示为 mcp__lodge_gate__submit_decision）。',
            '2. 如果工具列表里没有它，先调用 ToolSearch，查询 "lodge_gate_submit_decision"，再调用它。',
            '3. 只有工具确实不可用时，才按下面的文本格式回复；此时第一行只写「返工」或「交给人」。',
            '返工时写清改什么、怎么算完成；交给人时写清要人拍板什么。',
            '交给人时，在 actionRequired 里用 A. / B. 列出 2–3 个具体选择，每项一句话；用户会直接点。',
            DECISION_JSON_HINT,
            '决定返工时不要 @ 任何人；系统会把要求直接送进该重做的执行官手里。第一行仍只写「返工」。',
            '不要自己改文件，也不要自己验收。',
            INTERNAL_PROMPT_MARKER,
          ].join('\n'),
          parentAssignmentId: reviewAssignment?.id ?? null,
          nonce: String(pending.evidenceId ?? pending.verifier),
        }).then(() => {
          // 先叫醒规划师，再在群里投影这一棒。
          appendHandoffProjection({
            store,
            roomId,
            room,
            from: pending.verifier,
            targets: [lead],
            message: to => `验收退回了第 ${pending.stage + 1} 步；@${to.map(id => memberDisplayName(room, id)).join('、@')} 接手决定重做还是交给人。`,
            meta: {
              stage: pending.stage,
              reason: 'decision',
              dedupeKey: `decision:${pending.stage}:${verdictMessage.id}:${lead}`,
            },
          })
        }).catch(error => {
          systemNotice({ store, roomId, text: '没能叫醒规划师；稍后会自动再试。', error })
        })
      }
    }
  }

  return true
}

// 复核通过就是进展：暂停中的房间先恢复，否则系统收口会被“房间已暂停”挡住，
// 一条已经通过的判定就永远落不了地。
export const resumePausedForReviewPass = (store, roomId) => {
  const room = store.readRoom(roomId)
  if (room?.state !== ROOM_STATE.paused) return false
  const updated = store.updateRoom(roomId, current => {
    if (current.state !== ROOM_STATE.paused) return null
    current.state = ROOM_STATE.active
    current.idle = false
    current.noProgress = 0
    return { events: [{ type: 'room.resumed', payload: { reason: 'review-passed' } }] }
  })
  return updated !== null
}
