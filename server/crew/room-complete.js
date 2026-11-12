import { join } from 'node:path'
import { roomRootOf } from './paths.js'
import { writeConclusion } from './room-repo.js'
import { persistenceKind } from './service-policy.js'
import { workspaceProvider } from './workspace.js'

export const createRoomCompleter = ({ store, emit }) => {
  const { readRoom, readMessages, updateRoom, appendMessage, appendEvent } = store

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

  return { completeRoom }
}
