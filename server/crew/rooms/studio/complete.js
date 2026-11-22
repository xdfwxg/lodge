import { join } from 'node:path'
import { persistenceKind } from '../../service-policy.js'
import { transitionAssignment } from '../../assignments.js'
import { ASSIGNMENT_STATUS, ROUND_STATUS } from '../../../../shared/states.js'

export const createRoomCompleter = ({ store, emit, roomFiles, workspace }) => {
  const { readMessages, readAssignments, appendMessage, appendEvent } = store

  const completeRoom = room => {
    const round = room.workRound ?? null
    if (round?.status === ROUND_STATUS.completed) return room
    if (round === null) {
      appendMessage(room.id, { kind: 'system', text: '这一轮没有轮次记录，先停下了。' })
      return room
    }
    const open = readAssignments(room.id, { limit: 500 })
      .filter(assignment => !['passed', 'rejected', 'failed', 'cancelled'].includes(assignment.status))
    // 收尾交接只是请规划师说两句，不是交付的一部分；验收通过后它不该把整轮卡住。
    for (const summary of open.filter(assignment => assignment.reason === 'summary')) {
      transitionAssignment(store, summary.id, ASSIGNMENT_STATUS.passed)
    }
    if (open.some(assignment => assignment.reason !== 'summary')) {
      appendMessage(room.id, { kind: 'system', text: '还有交接没有收口，这一轮先不能结束。' })
      return room
    }
    // 收口可能被重试（启动补账、同一阶段再次确认）；同一轮的结论只写一次。
    const startedAt = Number.isFinite(round.stages?.[0]?.activatedAt) ? round.stages[0].activatedAt : null
    const alreadyConcluded = readMessages(room.id).some(message => (
      message.kind === 'conclusion' &&
      (message.meta?.roundId === round.id ||
        (startedAt !== null && typeof message.ts === 'number' && message.ts >= startedAt))
    ))
    if (!alreadyConcluded) {
      appendMessage(room.id, {
        kind: 'conclusion',
        authorId: 'planner',
        text: `已交付：${room.goal}`,
        meta: {
          stages: room.stages.length,
          commands: room.stages.map(item => item.acceptance).filter(Boolean),
          roundId: round.id,
        },
      })
      appendEvent(room.id, 'room.conclusion', {
        stages: room.stages.length,
        commands: room.stages.map(item => item.acceptance).filter(Boolean),
      })
    }
    if (room.demo === true) {
      appendMessage(room.id, { kind: 'system', text: '示例房间 · 不写结论文件，也不生成版本记录' })
      return room
    }
    roomFiles.writeConclusion(room)

    const roomWorkspace = workspace.provider(room)
    const capabilities = roomWorkspace.capabilities()
    const delivered = readMessages(room.id).flatMap(message => [
      ...(message.meta?.artifacts ?? []).map(artifact => artifact.path).filter(Boolean),
      ...(message.meta?.changedFiles ?? []).map(file => join(roomFiles.roomRootOf(room), file)),
    ])
    // 长期工作室不在轮次结束时清理成员工作区；下一轮还要用同一套目录。
    const persistence = persistenceKind(capabilities)
    let commitHash = null
    if (persistence !== 'commit') {
      appendEvent(room.id, 'room.commit', {
        status: persistence === 'archive' ? 'archive' : 'unavailable',
        vcs: capabilities.vcs ?? 'none',
      })
    } else {
      const committed = roomWorkspace.persistRoom({ room, files: delivered })
      appendEvent(room.id, 'room.commit', { status: committed ? 'done' : 'failed', vcs: capabilities.vcs })
      if (!committed) {
        appendMessage(room.id, { kind: 'system', text: capabilities.vcs === 'git' ? '版本没能保存，详情在服务端日志' : '交付记录没能归档，详见服务端日志' })
      }
      if (committed && capabilities.commit === true) {
        try {
          commitHash = roomWorkspace.head({ path: roomFiles.roomRootOf(room) })
        } catch {
          commitHash = null
        }
      }
    }

    const completedAt = Date.now()
    const completion = {
      goal: round.goal,
      stages: (round.stages ?? []).map(stage => ({ title: stage.title, kind: stage.kind, state: stage.state })),
      decisions: (round.decisions ?? []).map(item => item.chosen ?? item.answer ?? '').filter(Boolean),
      constraints: (round.constraints ?? []).slice(0, 6),
      completedAt,
      completedCommit: commitHash,
    }
    const finished = store.finishWorkRound?.({
      roomId: room.id,
      roundId: round.id,
      status: ROUND_STATUS.completed,
      patch: { completedAt, completedCommit: commitHash, completion },
      eventType: 'round.completed',
      eventPayload: { stages: room.stages.length },
      idempotencyKey: `round-complete:${round.id}`,
    }) ?? null
    if (finished === null) {
      appendMessage(room.id, { kind: 'system', text: '这一轮没能收口，还停在原来这一步；待处理。' })
      return room
    }
    if (finished.round !== null && finished.round !== undefined) emit('round', finished.round)
    if (finished.room !== null && finished.room !== undefined) emit('room', finished.room)
    return finished.room ?? store.readRoom(room.id) ?? room
  }

  return { completeRoom }
}
