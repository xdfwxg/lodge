import { fail, ok } from '../../result.js'
import { studioTransitionEvent, transitionStudio } from './state.js'

// 回到某个阶段的起点：代码回退到 stageBases[index]，之后的阶段重来；
// 证据与消息不删除，回退前的 HEAD 留在备份分支。
export const createStageRewind = ({ store, live, emit, roomFiles, workspace }) => {
  const { appendMessage, updateRoom } = store

  return async (room, body) => {
    const index = Number(body?.stage)
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : ''
    const stage = room.stages?.[index]
    if (stage === undefined) return fail('invalid', '没有这个阶段')
    if (stage.state === 'pending') return fail('conflict', '这个阶段还没开始')
    if (stage.kind !== 'deliverable' && stage.manual !== true) return fail('invalid', '决策阶段没有代码可以回退')
    if (room.state !== 'active') return fail('conflict', '先继续房间，再回到之前的阶段')
    if (room.busy === true) return fail('conflict', '房间还有回合在跑；先等这一回合结束')
    if (room.live === true && typeof live.busyReview === 'function' && live.busyReview(room.id)) {
      return fail('conflict', '复核进行中，先等验收结论')
    }
    const base = room.stageBases?.[index]
    if (typeof base !== 'string' || base === '') {
      return fail('conflict', '这个阶段没有记录代码起点，不能回退')
    }
    const provider = workspace.provider(room)
    if (provider.capabilities().vcs !== 'git' || typeof provider.restore !== 'function') {
      return fail('conflict', '当前工作区不支持回退代码；只能重做当前阶段')
    }
    const moved = transitionStudio(room.closure ?? 'open', 'rewind')
    if (!moved.ok) return fail('conflict', moved.error)
    let restored
    try {
      restored = provider.restore({ room, base })
    } catch (error) {
      return fail('conflict', error?.message ?? error)
    }
    const message = appendMessage(room.id, {
      kind: 'rework',
      authorId: 'you',
      text: note === '' ? `回到阶段 ${index + 1} 的起点重来。` : `回到阶段 ${index + 1} 的起点重来：${note}`,
      meta: { stage: index, rewind: true, requestedAt: Date.now() },
    })
    const closureEvent = studioTransitionEvent(moved, 'rewind', 'you', {}, `回到阶段 ${index + 1}`)
    const updated = updateRoom(room.id, current => {
      const target = current.stages?.[index]
      if (target === undefined || target.state === 'pending') return null
      current.closure = moved.state
      current.stages = current.stages.map((item, i) => {
        if (i < index) return item
        if (i === index) return { ...item, state: 'active', tasks: [] }
        return { ...item, state: 'pending', tasks: [] }
      })
      current.stageBases = Object.fromEntries(Object.entries(current.stageBases ?? {})
        .filter(([key]) => Number(key) <= index))
      return {
        events: [
          { type: 'stage.rewound', payload: { stage: index, base, backups: restored.backups } },
          closureEvent,
        ],
      }
    })
    if (updated === null) {
      return fail('conflict', '阶段状态已变化；代码已回退，但房间状态没有更新，请刷新后重试')
    }
    roomFiles.writeGoal(updated)
    emit('room', updated)
    appendMessage(room.id, {
      kind: 'system',
      text: `已回到阶段 ${index + 1} 的起点；回退前的代码保存在 ${restored.backups.join('、')}，备份分支会由工作区 GC 定期清理。`,
    })
    if (room.live === true && typeof live.reworkStage === 'function') {
      void live.reworkStage(updated, index, note).catch(error => {
        appendMessage(room.id, { kind: 'system', text: `回退后重启阶段失败：${error?.message ?? error}` })
      })
    } else {
      appendMessage(room.id, { kind: 'system', text: '回退已完成；这个房间没有连接实时基座，需要你继续或重新开工。' })
    }
    return ok({ room: updated, message })
  }
}
