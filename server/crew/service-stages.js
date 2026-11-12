import { join } from 'node:path'
import { budgetHint, budgetStatus } from './budget.js'
import { gateFor } from './gates.js'
import { roomRootOf } from './paths.js'
import { fail, ok } from './result.js'
import { writeConclusion, writeGoal } from './room-repo.js'
import { acceptanceChangeError, persistenceKind } from './service-policy.js'
import { editStages } from './stage-plan.js'
import { workspaceProvider } from './workspace.js'

export const createServiceStages = ({ store, live, emit, dispatchPayload }) => {
  const { readRoom, readRooms, readMessages, updateRoom, appendMessage, appendEvent } = store

  const editStagePlan = (room, body) => {
    const result = editStages(room, body?.action, body?.index, body?.stage)
    if (result.error !== undefined) return fail('invalid', result.error)
    const updated = updateRoom(room.id, current => {
      current.stages = result.stages
      return { events: [result.event] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    writeGoal(updated)
    emit('room', updated)
    appendMessage(room.id, {
      kind: 'system',
      text: result.event.type === 'stage.added'
        ? `已添加阶段：${updated.stages[result.event.payload.index]?.title ?? ''}`
        : result.event.type === 'stage.removed'
          ? '已移除一个未开始阶段'
          : `已更新阶段：${updated.stages[result.event.payload.index]?.title ?? ''}`,
    })
    return ok({ room: updated })
  }

  const completeRoom = room => {
    appendMessage(room.id, {
      kind: 'conclusion',
      authorId: 'planner',
      text: `目标达成：${room.goal}`,
      meta: {
        stages: room.stages.length,
        commands: room.stages.map(item => item.acceptance).filter(Boolean),
      },
    })
    appendEvent(room.id, 'room.conclusion', {
      stages: room.stages.length,
      commands: room.stages.map(item => item.acceptance).filter(Boolean),
    })
    if (room.demo === true) {
      appendMessage(room.id, { kind: 'system', text: '演示房间 · 不写 CONCLUSION.md，不产生 commit' })
      return room
    }
    writeConclusion(room)
    const archived = updateRoom(room.id, current => {
      current.pastGoals = [...(current.pastGoals ?? []), {
        goal: current.goal,
        stages: current.stages.map(stage => ({ title: stage.title, kind: stage.kind, state: stage.state })),
        completedAt: Date.now(),
      }].slice(-5)
      return { events: [{ type: 'goal.archived', payload: { stages: current.stages.length } }] }
    })
    if (archived !== null) emit('room', archived)
    const workspace = workspaceProvider(room)
    const capabilities = workspace.capabilities()
    const delivered = readMessages(room.id).flatMap(message => [
      ...(message.meta?.artifacts ?? []).map(artifact => artifact.path).filter(Boolean),
      ...(message.meta?.changedFiles ?? []).map(file => join(roomRootOf(room), file)),
    ])
    // 交付目录保留；只清掉非交付席位工作区。git 房间的候选分支仍在源仓库，可人工重建查看。
    try {
      const pruned = workspace.pruneSeats(room)
      const fresh = pruned.filter(seat => !(room.prunedSeats ?? []).includes(seat))
      if (fresh.length > 0) {
        const updated = updateRoom(room.id, current => {
          current.prunedSeats = pruned
          return { events: [{ type: 'room.prune', payload: { seats: fresh } }] }
        })
        if (updated !== null) {
          emit('room', updated)
          appendMessage(room.id, {
            kind: 'system',
            text: capabilities.vcs === 'git'
              ? `非交付工作区已清理：${fresh.join('、')}；候选分支保留在源仓库。`
              : `非交付工作区已清理：${fresh.join('、')}。`,
          })
        }
      }
    } catch (error) {
      appendMessage(room.id, { kind: 'system', text: `非交付工作区清理失败：${error?.message ?? error}` })
    }
    const persistence = persistenceKind(capabilities)
    if (persistence !== 'commit') {
      appendEvent(room.id, 'room.commit', {
        status: persistence === 'archive' ? 'archive' : 'unavailable',
        vcs: capabilities.vcs ?? 'none',
      })
      appendMessage(room.id, {
        kind: 'system',
        text: persistence === 'archive'
          ? '已写入 CONCLUSION.md · 当前工作区无版本控制，房间记录与交接包留痕'
          : '已写入 CONCLUSION.md · 本机 git 不可用，未产生 commit',
      })
      return store.readRoom(room.id) ?? room
    }
    // 先落这条完成记录，再提交，避免提交后 transcript 又变脏。
    appendMessage(room.id, {
      kind: 'system',
      text: capabilities.vcs === 'git'
        ? '已写入 CONCLUSION.md · 本地 commit 一次 · 未 push'
        : '已写入 CONCLUSION.md · 已归档一次交付记录',
    })
    const committed = workspace.persistRoom({ room, files: delivered })
    appendEvent(room.id, 'room.commit', { status: committed ? 'done' : 'failed', vcs: capabilities.vcs })
    if (!committed) {
      appendMessage(room.id, { kind: 'system', text: capabilities.vcs === 'git' ? 'commit 失败，详见服务端日志' : '交付记录归档失败，详见服务端日志' })
    }
    let commitHash = null
    if (committed && capabilities.commit === true) {
      try {
        commitHash = workspace.head({ path: roomRootOf(room) })
      } catch {
        commitHash = null
      }
    }
    const finalized = updateRoom(room.id, current => {
      current.completedAt = current.completedAt ?? Date.now()
      if (commitHash !== null) current.completedCommit = commitHash
      return { events: [] }
    })
    if (finalized !== null) emit('room', finalized)
    return finalized ?? store.readRoom(room.id) ?? room
  }

  const accept = (room, body) => {
    const index = Number(body.stage)
    let gate = null
    let next = -1
    const updated = updateRoom(room.id, current => {
      gate = gateFor(current, index, readMessages(room.id))
      if (!gate.ok) return null
      const stage = current.stages[index]
      stage.state = 'passed'
      if (Array.isArray(stage.tasks)) stage.tasks = stage.tasks.map(task => ({ ...task, status: 'done' }))
      next = current.stages.findIndex(item => item.state === 'pending')
      if (next >= 0) current.stages[next].state = 'active'
      else current.state = 'complete'
      return {
        events: [
          { type: 'stage.passed', payload: { stage: index, kind: stage.kind, by: 'you' } },
          ...(next < 0 ? [{ type: 'room.complete', payload: {} }] : []),
        ],
      }
    })
    if (gate !== null && gate.ok === false) return fail(gate.reason, gate.error)
    if (updated === null) return fail('not_found', '没有这个房间')
    room = updated
    if (!room.demo) writeGoal(room)
    emit('room', room)
    emit('dispatch', dispatchPayload())
    appendMessage(room.id, {
      kind: 'system',
      text: gate.stage.kind === 'deliverable'
        ? `阶段 ${index + 1} 已按证据验收`
        : `阶段 ${index + 1} 已由你确认`,
      meta: { kind: 'gate', gate: gate.stage.kind, stage: index, by: 'you' },
    })
    let finalRoom = next < 0 ? completeRoom(room) ?? room : room
    if (next >= 0 && room.live === true && room.stages[next]?.kind === 'deliverable' && typeof live.startStage === 'function') {
      const status = budgetStatus(room, readRooms())
      if (!status.ok) {
        const paused = updateRoom(room.id, current => {
          if (current.state !== 'active') return null
          current.state = 'paused'
          current.pauseReason = 'budget'
          current.budgetBlocked = true
          current.idle = false
          return { events: [{ type: 'room.budget_pause', payload: { reason: status.roomBlocked ? 'room' : 'global' } }] }
        })
        if (paused !== null) {
          appendMessage(room.id, {
            kind: 'system',
            text: `预算已用尽：${status.message}；下一阶段已暂停，${budgetHint(status)}。`,
          })
          emit('room', paused)
          emit('dispatch', dispatchPayload())
          finalRoom = paused
        }
      } else {
        void live.startStage(room, next).catch(error => {
          appendMessage(room.id, { kind: 'system', text: `启动执行失败：${error?.message ?? error}` })
        })
      }
    }
    return ok({ room: finalRoom })
  }

  const setAcceptance = (room, index, command) => {
    let rejection = null
    const updated = updateRoom(room.id, current => {
      const stage = current.stages[index]
      const invalid = acceptanceChangeError(stage, command)
      if (invalid !== null) {
        rejection = invalid
        return null
      }
      const trimmed = command.trim()
      if (trimmed === '') delete stage.acceptance
      else stage.acceptance = trimmed
      return { events: [{ type: 'stage.acceptance', payload: { stage: index, command: stage.acceptance ?? '' } }] }
    })
    if (rejection !== null) return fail(rejection[0], rejection[1])
    if (updated === null) return fail('not_found', '没有这个房间')
    room = updated
    if (!room.demo) writeGoal(room)
    emit('room', room)
    const trimmed = command.trim()
    const message = appendMessage(room.id, {
      kind: 'system',
      text: trimmed === ''
        ? `阶段 ${index + 1} 的验收命令已清空`
        : `阶段 ${index + 1} 的验收命令：\`${trimmed}\``,
    })
    return ok({ room, message })
  }

  return { editStagePlan, completeRoom, accept, setAcceptance }
}
