import { reviewState, reworkFloor } from '../acceptance/verifiers.js'
import { isWorkStage } from './turn-utils.js'
import {
  activeDispatchAssignments as activeDispatch,
  transitionAssignment,
  updateAssignment,
} from '../../../assignments.js'
import { dispatchOf } from '../../../assignment-projections.js'
import { leadMemberOf, workerIds } from '../../../room-members.js'
import { workspaceOf } from './workspace.js'
import { systemNotice } from '../../../notices.js'
import { PLANNER_DECISION_KIND, REVIEW_STATE, ROOM_STATE, STAGE_STATE } from '../../../../../shared/states.js'

export const createResume = ({
  store,
  roomId,
  emit,
  sendToMember,
  integrator,
  review,
  stageStarter,
  markResultReady,
}) => {
  const resumeOnce = async () => {
    const room = store.readRoom(roomId)
    if (room === null) return
    if (room.live !== true || room.state !== ROOM_STATE.active) return
    if ((room.busyMembers ?? []).length > 0 || workerIds(room).length === 0) return
    const stageIndex = room.stages.findIndex(stage => stage.state === STAGE_STATE.active)
    if (stageIndex < 0) return
    const stage = room.stages[stageIndex]
    if (!isWorkStage(stage)) return
    // 规划师已经把它交给人：重启不替人继续派活。
    if (room.lastPlannerDecision?.stage === stageIndex && room.lastPlannerDecision?.kind === PLANNER_DECISION_KIND.human) return

    const messages = store.readMessages(roomId)
    // 重做之后只认这一拍的结果；上一拍的回合不能把重做直接判成完成。
    const floor = reworkFloor(messages, stageIndex)
    const evidence = messages.filter(message => (
      message.kind === 'evidence' &&
      (message.meta?.stage ?? 0) === stageIndex &&
      (room.demo === true || message.meta?.simulated !== true) &&
      (message.seq ?? 0) > floor
    ))
    const latestTurn = [...evidence].reverse().find(message => message.meta?.kind === 'turn')
    const latestResult = [...evidence].reverse().find(message => message.meta?.kind === 'result')
    const dispatch = dispatchOf(store, roomId, stageIndex)

    if (dispatch?.stage === stageIndex) {
      if (dispatch.stalled === true) return
      if (dispatch.timedOut === true) {
        for (const item of activeDispatch(store, roomId, stageIndex)) {
          if (item.flags?.timedOut !== true) continue
          updateAssignment(store, item.id, { flags: { ...(item.flags ?? {}), timedOut: false } })
        }
      }
      const reported = new Set(
        evidence.filter(message => message.meta?.kind === 'turn').map(message => message.authorId),
      )
      // 只补叫醒还没交回回合的交接；已经交回的成员不再收到第二次唤醒。
      const openDispatch = activeDispatch(store, roomId, stageIndex)
        .filter(item => ['created', 'sent', 'working'].includes(item.status))
      const missing = openDispatch.filter(item => !reported.has(item.toMemberId))
      if (missing.length > 0) {
        // 重启后按“有没有产生副作用”决定续接方式：动过工具就只续接，不要再从头跑一遍。
        for (const item of missing) {
          const prompt = typeof item.brief?.prompt === 'string' ? item.brief.prompt : ''
          const acted = messages.some(message => (
            message.kind === 'activity' &&
            message.authorId === item.toMemberId &&
            (message.ts ?? 0) >= (item.sentAt ?? 0)
          ))
          if (acted) {
            try {
              await sendToMember(
                item.toMemberId,
                '继续刚才没做完的部分；如果已经完成，只汇报结果和证据，不要从头再来。',
                {
                  intent: 'handoff',
                  from: item.fromMemberId ?? leadMemberOf(room)?.id ?? '房间',
                  sendId: `resume-${item.id}`,
                },
              )
            } catch (error) {
              systemNotice({ store, roomId, text: '上次没做完的这一步没能续接；待处理。', error })
            }
            continue
          }
          if (prompt === '') {
            // 旧记录没有存任务原文：退回原来的派发方式。
            try {
              await stageStarter.startStage(room, stageIndex, { only: [item.toMemberId], rework: item.reason === 'rework' })
            } catch (error) {
              systemNotice({ store, roomId, text: '上次没做完的这一步没能继续；待处理。', error })
            }
            continue
          }
          if (item.flags?.resumed === true) {
            // 零产出重启过一次还是没有产出：停下来交给人，不再无限重发。
            transitionAssignment(store, item.id, 'failed', { resultText: '零产出重启后仍没有结果' })
            systemNotice({ store, roomId, text: '这一步重启后仍然没有产出；待处理。' })
            continue
          }
          updateAssignment(store, item.id, { flags: { ...(item.flags ?? {}), resumed: true } })
          try {
            await sendToMember(item.toMemberId, prompt, {
              intent: item.reason === 'review' ? 'review' : 'handoff',
              from: item.fromMemberId ?? leadMemberOf(room)?.id ?? '房间',
              sendId: `resume-${item.id}`,
            })
            const cleared = store.updateRound(roomId, current => {
              if (current.blocked?.stage !== stageIndex) return null
              current.blocked = null
              return { events: [] }
            })
            if (cleared !== null) emit?.('room', cleared)
          } catch (error) {
            systemNotice({ store, roomId, text: '上次没做完的这一步没能继续；待处理。', error })
          }
        }
        return
      }
      const failed = [...new Set([
        ...(dispatch.failed ?? []),
        ...(dispatch.workers ?? []).filter(worker => !reported.has(worker)),
      ])]
      const workers = (dispatch.workers ?? []).filter(worker => reported.has(worker) && !failed.includes(worker))
      if (workers.length === 0) {
        for (const item of activeDispatch(store, roomId, stageIndex)) {
          updateAssignment(store, item.id, { flags: { ...(item.flags ?? {}), stalled: true } })
        }
        systemNotice({ store, roomId, text: '上次没做完的这一步仍然没有产出；待处理。' })
        emit?.('room', store.readRoom(roomId))
        return
      }
      await integrator.enqueue(() => integrator.integrate({
        stageIndex,
        workers,
        base: dispatch.base ?? workspaceOf(room).head({ path: room.repoPath }),
        turnId: latestTurn?.meta?.turnId ?? '',
        failed,
      }))
      return
    }

    if (latestResult !== undefined) {
      // 结果已经落下，但重启会丢掉内存里的复核轮；没有结论就重新发起。
      const outcome = reviewState({ room, evidence: store.readEvidence?.(roomId), messages, stageIndex })
      if (outcome.state === REVIEW_STATE.pending) {
        try {
          await review.request(stageIndex)
        } catch (error) {
          systemNotice({ store, roomId, text: '这一步上次没做完，已经停了；待处理。', error })
        }
      }
      return
    }

    if (latestTurn !== undefined) {
      if (typeof latestTurn.meta?.turnId === 'string') {
        await markResultReady(room, stageIndex, latestTurn.meta.turnId, true, latestTurn.text ?? '')
      }
      return
    }

    if (dispatch?.stage === stageIndex && (dispatch.stalled === true || dispatch.timedOut === true)) return
    await stageStarter.startStage(room, stageIndex)
  }

  return resumeOnce
}
