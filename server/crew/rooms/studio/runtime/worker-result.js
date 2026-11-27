// 执行官（worker）回合的落库：证据、写边界、分片、候选提交、送复核。
// 一次回合的收尾规则都在这一个文件里；编排在 turn-capture.js。
import { createHash } from 'node:crypto'
import { memberDisplayName } from '../../../member-labels.js'
import { verdictPassed } from '../../../../../shared/judgment.js'
import { STAGE_STATE } from '../../../../../shared/states.js'
import { dispatchOf } from '../../../assignment-projections.js'
import { isWorkStage } from './turn-utils.js'
import { vcsOf, workspaceOf } from './workspace.js'
import { systemNotice } from '../../../notices.js'
import { cancelAssignmentLease } from '../plan/assignment-lease.js'
import { transitionAssignment } from '../../../assignments.js'
import { redactSecrets } from '../../../../../shared/secrets.js'
import { parkPackageProof } from '../delivery/proof-assembly.js'
import { enforceWriteBoundary } from './result.js'
import { ownsProofFileFor } from '../delivery/write-boundary.js'
import { packageProofFile } from '../../../../../shared/proof.js'

export const captureWorkerResult = async (deps) => {
  const {
    store, roomId, emit, files, state, integrator, review, markResultReady,
    room, memberId, turn, turnId, calls, stageIndex, dispatch, parallel,
    assignment, pendingForMember, writeTurn,
  } = deps
  const dispatchNow = dispatch

    const stage = stageIndex

    // 同一个回合可能同时从群聊和成员自己的线程各重放一次，turnId 不同但内容相同；
    // 同一步同一位成员在两分钟内说过完全相同的话，只留第一条证据。
    const replyText = String(turn.reply ?? '').trim()
    const duplicated = replyText !== '' && memberId !== null && store.readMessages(roomId).some(message => (
      message.kind === 'evidence' &&
      message.authorId === memberId &&
      (message.meta?.stage ?? 0) === stage &&
      String(message.text ?? '').trim() === replyText &&
      typeof message.ts === 'number' &&
      Math.abs(Date.now() - message.ts) <= 120_000
    ))
    if (duplicated) {
      state.capturedTurns.add(turnId)
      writeTurn('duplicate')
      return
    }

    // 成员交回第一个新的证据回合就算有进展：停掉成员自己的计时，后面的长回合交给阶段截止兜底。
    if (assignment !== null && ['sent', 'working'].includes(assignment.status)) {
      cancelAssignmentLease({ store, roomId, assignmentId: assignment.id })
    }

    const artifacts = []
    for (const call of calls) {
      let input
      try {
        input = JSON.parse(call.input ?? '{}')
      } catch {
        continue
      }
      const filePath = input.file_path
      if (typeof filePath !== 'string' || !files.exists(filePath)) continue
      if (artifacts.some(item => item.path === filePath)) continue
      const content = files.read(filePath)
      artifacts.push({
        path: filePath,
        bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        content: content.length > 16_384
          ? `${content.subarray(0, 16_384).toString('utf8')}\n…`
          : content.toString('utf8'),
      })
    }

    const worked = (turn.toolCalls ?? 0) > 0 || artifacts.length > 0
    const toolSummary = (turn.tools ?? []).map(tool => `${tool.name} ×${tool.count}${tool.failed ? ` (${tool.failed} 失败)` : ''}`)
    const summary = [
      toolSummary.length > 0 ? `工具：${toolSummary.join(' · ')}` : '工具：无',
      `回合：${((turn.durationMs ?? 0) / 1000).toFixed(1)}s`,
    ].join(' · ')
    const evidence = {
      kind: 'evidence',
      authorId: memberId ?? 'worker',
      ts: Date.now(),
      text: redactSecrets(turn.reply || summary),
      meta: {
        kind: 'turn',
        vcs: vcsOf(room),
        stage,
        turnId,
        summary,
        durationMs: turn.durationMs,
        files: artifacts.map(item => item.path.split('/').at(-1)),
        artifacts,
        output: redactSecrets(JSON.stringify({
          tools: turn.tools ?? [],
          toolCalls: turn.toolCalls,
          hookCoverage: turn.hookCoverage,
        }, null, 2)),
        capturedAt: new Date().toISOString(),
      },
    }

    if (parallel) {
      void integrator.enqueue(async () => {
        const current = store.readRoom(roomId)
        if (current === null) return
        const worktree = current.worktrees?.[memberId]
        // 并行回合也要先过写边界：只在提交候选之前退包外改动，否则两个执行官会把整份交付
        // 各写一遍，合并在同一个文件上撞车（真房第二十二十三轮）。
        const outOfBounds = worktree === undefined ? null : await enforceWriteBoundary({
          store,
          roomId,
          room: current,
          stage: current.stages?.[stage],
          stageIndex: stage,
          memberId,
          repoPath: worktree,
          provider: workspaceOf(current),
          filePort: files,
        })
        // 并行阶段一个包一份证明：认领了 lodge-proof.json 的那个包留在根目录（交付里就一个写者），
        // 没认领的包如果写了根证明才挪成它这一包的分片——两个包才不会在同一路径上撞车。
        const workerIndex = Math.max(0, (dispatch?.workers ?? []).indexOf(memberId))
        const owns = ownsProofFileFor({ room: current, stage: current.stages?.[stage], memberId })
        if (!owns && worktree !== undefined && parkPackageProof({ path: worktree, index: workerIndex })) {
          store.appendEvent(roomId, 'proof.parked', { stage, memberId, file: packageProofFile(workerIndex) })
        }
        let candidate = null
        if (worktree !== undefined && workspaceOf(current).capabilities().candidate === true) {
          try {
            candidate = workspaceOf(current).submit({ path: worktree, turnId, name: current.name })
            if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage, turnId, memberId, commit: candidate })
          } catch (error) {
            systemNotice({ store, roomId, text: '这一步没法准备检查；结果由你确认。', error })
          }
        }
        const base = dispatch?.stage === stage && typeof dispatch.base === 'string'
          ? dispatch.base
          : workspaceOf(current).head({ path: current.repoPath })
        const range = worktree === undefined
          ? { diff: '', files: [] }
          : await workspaceOf(current).rangeChanges({ path: worktree, base })
        const head = worktree === undefined ? '' : workspaceOf(current).head({ path: worktree })
        const stored = store.appendMessage(roomId, {
          ...evidence,
          meta: {
            ...evidence.meta,
            repoPath: worktree ?? '',
            branch: current.branches?.[memberId] ?? '',
            head,
            diff: redactSecrets(range.diff),
            manifest: range.manifest ?? [],
            changedFiles: range.files,
            candidate,
            ...(outOfBounds === null ? {} : { outOfBounds }),
          },
        })
        if (assignment !== null) {
          transitionAssignment(store, assignment.id, 'reported', { turnId, evidenceIds: [stored.id], ...(candidate === null ? {} : { candidate }) })
          cancelAssignmentLease({ store, roomId, assignmentId: assignment.id })
        }
        writeTurn('evidence', {
          evidenceIds: [stored.id],
          assignmentId: assignment?.id ?? null,
          candidate,
        })
        store.appendEvent(roomId, 'turn.evidence', { stage, turnId, memberId })
        state.recordTurn(artifacts.length > 0 || (turn.toolCalls ?? 0) > 0)

        const done = integrator.settle(memberId, turnId, false)
        if (done !== null) {
          const remaining = done.workers.filter(worker => !done.failed.includes(worker))
          if (remaining.length === 0) {
            systemNotice({ store, roomId, text: '这一步没有可合并的结果；待处理。' })
          } else {
            await integrator.integrate({ ...done, workers: remaining, turnId })
          }
          return
        }
        if (pendingForMember) return
        if (dispatch !== null && dispatch !== undefined && dispatch.stage !== stage) return
        const active = current.stages[stage]
        if (active === undefined || !isWorkStage(active) || active.state !== STAGE_STATE.active) return
        if (review.isBusy()) return
        const latest = [...store.readMessages(roomId)].reverse()
          .find(message => message.kind === 'verdict' && message.meta?.stage === stage)
        if (latest !== undefined && verdictPassed(latest)) return
        await integrator.integrate({ stageIndex: stage, workers: [memberId], base: workspaceOf(current).head({ path: current.repoPath }), turnId })
      })
      return
    }

    const storedEvidence = store.appendMessage(roomId, evidence)
    if (assignment !== null) {
      transitionAssignment(store, assignment.id, 'reported', { turnId, evidenceIds: [storedEvidence.id] })
      cancelAssignmentLease({ store, roomId, assignmentId: assignment.id })
      writeTurn('evidence', {
        evidenceIds: [storedEvidence.id],
        assignmentId: assignment.id,
      })
    }
    store.appendEvent(roomId, 'turn.evidence', { stage, turnId })
    state.recordTurn(artifacts.length > 0 || (turn.toolCalls ?? 0) > 0)

    if (room !== null) {
      const target = room.stages[stage]
      const key = `${stage}:${turnId}`
      if (target?.kind === 'deliverable' && target.state === STAGE_STATE.active && !state.resultRuns.has(key)) {
        state.resultRuns.add(key)
        void markResultReady(room, stage, turnId, worked, turn?.reply ?? '', memberId ?? '').catch(error => {
          systemNotice({ store, roomId, text: '这一步的结果没能固定下来；待处理。', error })
        })
      }
    }
}
