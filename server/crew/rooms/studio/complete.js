import { join } from 'node:path'
import { persistenceKind } from '../../service-policy.js'

export const createRoomCompleter = ({ store, emit, roomFiles, workspace }) => {
  const { readRoom, readMessages, updateRoom, appendMessage, appendEvent } = store

  const completeRoom = room => {
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
    const archived = updateRoom(room.id, current => {
      current.state = 'complete'
      current.pastGoals = [...(current.pastGoals ?? []), {
        goal: current.goal,
        stages: current.stages.map(stage => ({ title: stage.title, kind: stage.kind, state: stage.state })),
        completedAt: Date.now(),
      }].slice(-5)
      return { events: [{ type: 'goal.archived', payload: { stages: current.stages.length } }] }
    })
    if (archived !== null) emit('room', archived)
    const roomWorkspace = workspace.provider(room)
    const capabilities = roomWorkspace.capabilities()
    const delivered = readMessages(room.id).flatMap(message => [
      ...(message.meta?.artifacts ?? []).map(artifact => artifact.path).filter(Boolean),
      ...(message.meta?.changedFiles ?? []).map(file => join(roomFiles.roomRootOf(room), file)),
    ])
    // 交付目录保留；只清掉非交付成员工作区。git 房间的候选分支仍在源仓库，可人工重建查看。
    try {
      const pruned = roomWorkspace.pruneMembers(room)
      const fresh = pruned.filter(member => !(room.prunedMembers ?? []).includes(member))
      if (fresh.length > 0) {
        const updated = updateRoom(room.id, current => {
          current.prunedMembers = pruned
          return { events: [{ type: 'room.prune', payload: { members: fresh } }] }
        })
        if (updated !== null) emit('room', updated)
      }
    } catch (error) {
      console.warn(`[lodge] 临时文件没能清理：${error?.message ?? error}`)
    }
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
