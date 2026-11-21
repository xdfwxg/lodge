import { join } from 'node:path'
import { persistenceKind } from '../../service-policy.js'

export const createRoomCompleter = ({ store, emit, roomFiles, workspace }) => {
  const { readRoom, readMessages, updateRoom, updateWorkRound, appendMessage, appendEvent } = store

  const completeRoom = room => {
    const round = room.workRound ?? null
    appendMessage(room.id, {
      kind: 'conclusion',
      authorId: 'planner',
      text: `已交付：${room.goal}`,
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
      appendMessage(room.id, { kind: 'system', text: '示例房间 · 不写结论文件，也不生成版本记录' })
      return room
    }
    roomFiles.writeConclusion(room)
    if (round !== null) {
      const completed = updateWorkRound(round.id, current => {
        current.status = 'completed'
        current.completedAt = current.completedAt ?? Date.now()
        current.completion = {
          goal: current.goal,
          stages: current.stages.map(stage => ({ title: stage.title, kind: stage.kind, state: stage.state })),
          completedAt: current.completedAt,
        }
        return true
      })
      if (completed !== null) emit('round', completed)
      const archived = updateRoom(room.id, current => {
        current.state = 'idle'
        current.activeRoundId = null
        current.lastRoundId = round.id
        current.idle = true
        return { events: [{ type: 'round.completed', payload: { roundId: round.id, stages: current.stages?.length ?? 0 } }] }
      })
      if (archived !== null) emit('room', archived)
    } else {
      // 旧房间的兼容路径只在测试 fixture 里出现；新房间都带 workRound。
      const archived = updateRoom(room.id, current => {
        current.state = 'complete'
        return { events: [{ type: 'goal.archived', payload: { stages: current.stages?.length ?? 0 } }] }
      })
      if (archived !== null) emit('room', archived)
    }
    if (typeof room.routineGoalId === 'string') {
      const goal = readRoom(room.routineGoalId)
      if (goal !== null) {
        const withResult = updateRoom(goal.id, current => {
          current.routine = {
            ...(current.routine ?? {}),
            lastFinishedAt: Date.now(),
            failures: 0,
            lastError: null,
            skippedAt: null,
            unseenResult: true,
          }
          return { events: [{ type: 'room.routine.finished', payload: { roomId: room.id } }] }
        })
        if (withResult !== null) emit('room', withResult)
      }
    }
    const roomWorkspace = workspace.provider(room)
    const capabilities = roomWorkspace.capabilities()
    const delivered = readMessages(room.id).flatMap(message => [
      ...(message.meta?.artifacts ?? []).map(artifact => artifact.path).filter(Boolean),
      ...(message.meta?.changedFiles ?? []).map(file => join(roomFiles.roomRootOf(room), file)),
    ])
    // 长期工作室不在轮次结束时清理成员工作区；下一轮还要用同一套目录。
    const persistence = persistenceKind(capabilities)
    if (persistence !== 'commit') {
      appendEvent(room.id, 'room.commit', {
        status: persistence === 'archive' ? 'archive' : 'unavailable',
        vcs: capabilities.vcs ?? 'none',
      })
      return store.readRoom(room.id) ?? room
    }
    const committed = roomWorkspace.persistRoom({ room, files: delivered })
    appendEvent(room.id, 'room.commit', { status: committed ? 'done' : 'failed', vcs: capabilities.vcs })
    if (!committed) {
      appendMessage(room.id, { kind: 'system', text: capabilities.vcs === 'git' ? '版本没能保存，详情在服务端日志' : '交付记录没能归档，详见服务端日志' })
    }
    let commitHash = null
    if (committed && capabilities.commit === true) {
      try {
        commitHash = roomWorkspace.head({ path: roomFiles.roomRootOf(room) })
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

  return { completeRoom }
}
