import { systemNotice } from '../../../notices.js'
import { verifierIds } from '../../../room-members.js'
import { detectCheckCommand } from '../../../project-checks.js'
import { MAX_AUTO_REWORKS, checkLedger, nextAutoRework } from '../auto-rework.js'
import { workspaceOf } from '../workspace.js'
import { AUTO_CHECK_REASON, AUTO_CHECK_STATUS, ROOM_STATE, STAGE_STATE } from '../../../../../shared/states.js'

export const createAutoCheck = ({
  store,
  roomId,
  emit,
  files,
  acceptance,
  review,
  stageStarter,
  state,
  expireCards = null,
  autoLoops,
  autoChecks,
}) => {
  // 自动检查没通过就退回重做，带着失败输出和影子评审的另一个角度；
  // 原地打转、次数、时间或额度触顶就停手，交给人决定。
  const shadowAdviceText = (room, stageIndex) => {
    const entry = room.advisorShadow?.[stageIndex]
    const advice = Array.isArray(entry?.advice) ? entry.advice[0] : null
    if (advice === null || typeof advice !== 'object') return ''
    const lines = [
      typeof advice.summary === 'string' ? advice.summary : '',
      ...(Array.isArray(advice.risks) ? advice.risks.map(item => `风险：${item}`) : []),
      ...(Array.isArray(advice.missingEvidence) ? advice.missingEvidence.map(item => `缺证据：${item}`) : []),
    ].filter(Boolean).slice(0, 5)
    return lines.length === 0 ? '' : `影子评审的另一个角度（仅供参考）：\n${lines.join('\n')}`
  }

  const stopAutoRework = ({ stageIndex, reason, status, attempts }) => {
    const text = reason === AUTO_CHECK_REASON['same-failure']
      ? '这一步没做成：同一处失败反复出现，重做也没绕开。待你决定下一步。'
      : reason === AUTO_CHECK_REASON.time
        ? '这一步还没做成：自动检查到时间上限就先停了。可以再试一次，或自己处理。'
        : reason === AUTO_CHECK_REASON.budget
          ? '这一步先停下了：房间额度用完了。结果和失败输出都还在房间里。'
          : '这一步没做成：自动检查试了几次都没通过。待你决定下一步。'
    store.appendMessage(roomId, { kind: 'system', text, meta: { autoCheckStop: status } })
    store.appendEvent(roomId, 'auto_rework.stopped', { stage: stageIndex, reason, status, attempts })
    setAutoCheck(stageIndex, { status, reason, attempts })
  }

  // 停止状态记在房间里：界面只说人话，次数和原因留在记录里备查。
  const setAutoCheck = (stageIndex, patch) => {
    const updated = store.updateRound(roomId, current => {
      if (patch === null) {
        if (current.autoCheck?.stage !== stageIndex) return null
        delete current.autoCheck
        return { events: [] }
      }
      current.autoCheck = {
        stage: stageIndex,
        maxAttempts: MAX_AUTO_REWORKS,
        at: Date.now(),
        ...(current.autoCheck?.stage === stageIndex ? current.autoCheck : {}),
        ...patch,
      }
      return { events: [{ type: 'room.auto_check', payload: { stage: stageIndex, status: patch.status, attempts: patch.attempts ?? 0 } }] }
    })
    if (updated !== null) emit?.('room', updated)
    return updated
  }

  // 房间记录就是进度账本：重做时把前几次试过什么一并带上，不只看见最后一次失败。
  const autoLedger = stageIndex => {
    const prior = store.readMessages(roomId)
      .filter(message => (
        message.kind === 'evidence' &&
        message.meta?.auto === true &&
        (message.meta?.stage ?? 0) === stageIndex
      ))
      .slice(0, -1)
    return checkLedger(prior, { startAt: Math.max(1, prior.length - 2) })
  }

  const autoRework = async ({ stageIndex, command, exit, output }) => {
    const room = store.readRoom(roomId)
    if (room === null || room.state !== ROOM_STATE.active) return
    if (room.mergeConflict?.stage === stageIndex) return
    const stage = room.stages?.[stageIndex]
    if (stage === undefined || stage.state !== STAGE_STATE.active || stage.manual !== true) return
    if ((room.busyMembers ?? []).length > 0) return
    const decision = nextAutoRework({ state: autoLoops.get(stageIndex), command, exit, output, room })
    autoLoops.set(stageIndex, decision.state)
    if (decision.retry !== true) {
      stopAutoRework({ stageIndex, reason: decision.reason, status: decision.status, attempts: decision.state.attempts })
      return
    }
    const tail = String(output ?? '').trim().slice(-1500)
    const note = [
      autoLedger(stageIndex),
      `自动检查没通过（第 ${decision.state.attempts} 次）：${command}（退出码 ${exit}）。`,
      tail,
      shadowAdviceText(room, stageIndex),
    ].filter(Boolean).join('\n')
    store.appendMessage(roomId, {
      kind: 'rework',
      authorId: 'system',
      text: '自动检查没通过，已重做这一步。',
      meta: { stage: stageIndex, source: 'auto', note },
    })
    if (typeof expireCards === 'function') expireCards()
    try {
      await stageStarter.startStage(room, stageIndex, { note, rework: true })
    } catch (error) {
      systemNotice({ store, roomId, text: '这一步没能自动重做；待处理。', error })
    }
  }

  // 产品自己保证检查：仓库里有能跑的检查就跑，认不出来就说清楚，不拿空命令问人。
  const autoCheck = (room, stageIndex, turnId) => {
    const key = `${stageIndex}:${turnId}`
    if (autoChecks.has(key)) return
    autoChecks.add(key)
    const detected = detectCheckCommand(files, room.repoPath)
    // 认不出检查就停在这里，由人看结果；不再往时间线写一条同义的小字。
    if (detected === null) return
    void acceptance.run(stageIndex, detected.command, turnId, { auto: true, reason: detected.reason })
  }

  const markManualReady = (room, stageIndex, turnId, worked) => {
    let candidate = null
    try {
      if (workspaceOf(room).capabilities().candidate === true) {
        candidate = workspaceOf(room).submit({ path: room.repoPath, turnId, name: room.name })
        if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage: stageIndex, turnId, commit: candidate })
      }
    } catch (error) {
      systemNotice({ store, roomId, text: '这一步没法准备检查；结果由你确认。', error })
    }
    const head = typeof workspaceOf(room).head === 'function' && typeof room.repoPath === 'string' && room.repoPath !== ''
      ? workspaceOf(room).head({ path: room.repoPath })
      : null
    const acceptedRef = candidate ?? head
    const baseline = room.stageBases?.[stageIndex] ?? room.startHead ?? null
    const changedFiles = acceptedRef === null
      ? []
      : baseline !== null
        ? workspaceOf(room).changedFilesSince?.({ path: room.repoPath, base: baseline }) ?? []
        : candidate !== null
          ? workspaceOf(room).filesInCommit?.({ path: room.repoPath, commit: candidate }) ?? []
          : []
    // 人工阶段没有命令可判“无改动”：同一 HEAD 上的重复回合不重复生成验收证据，也不重复送审。
    const prior = [...store.readMessages(roomId)].reverse().find(message => (
      message.kind === 'evidence' &&
      message.meta?.kind === 'manual' &&
      (message.meta?.stage ?? 0) === stageIndex
    ))
    const covered = prior?.meta?.candidate ?? prior?.meta?.head ?? null
    if (prior !== undefined) {
      if (covered !== null && acceptedRef !== null && covered === acceptedRef) return
      if (!worked && covered === null) return
    }
    const hasVerifier = verifierIds(room).length > 0
    store.appendMessage(roomId, {
      kind: 'evidence',
      authorId: 'system',
      // 有验收员时，复核请求会由系统单独发一条 @；这里只说结果。
      text: hasVerifier ? '结果已经好了。' : '结果已经好了，可以验收了。',
      meta: {
        kind: 'manual',
        stage: stageIndex,
        turnId,
        candidate,
        head: typeof acceptedRef === 'string' && acceptedRef !== '' ? acceptedRef : null,
        files: changedFiles,
        changedFiles,
        repoPath: room.repoPath,
        simulated: false,
        capturedAt: new Date().toISOString(),
      },
    })
    state.markProgress()
    if (hasVerifier) {
      void review.request(stageIndex).catch(error => {
        systemNotice({ store, roomId, text: '结果已经好了，但没能叫验收员来看；待处理。', error })
      })
    }
  }


  return { autoRework, autoCheck, markManualReady, setAutoCheck }
}
