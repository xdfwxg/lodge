import { createElement as h, useEffect, useState } from 'react'
import { stripAttachmentTags } from '../../../shared/attachments.js'
import { dateTimeOf } from '../view-format.js'

// A project is the linear chain of studio rooms, not another room engine.
export const projectTrailOf = (rooms, roomId) => {
  const byId = new Map((rooms ?? []).map(room => [room.id, room]))
  let cursor = byId.get(roomId)
  if (cursor === undefined) return null

  const seenBack = new Set()
  while (
    typeof cursor.sourceRoomId === 'string' &&
    byId.has(cursor.sourceRoomId) &&
    !seenBack.has(cursor.sourceRoomId)
  ) {
    seenBack.add(cursor.id)
    cursor = byId.get(cursor.sourceRoomId)
  }

  const phases = []
  const seenForward = new Set()
  while (cursor !== undefined && !seenForward.has(cursor.id)) {
    seenForward.add(cursor.id)
    phases.push(cursor)
    cursor = typeof cursor.nextRoomId === 'string' ? byId.get(cursor.nextRoomId) : undefined
  }

  return {
    root: phases[0],
    phases,
    current: phases[phases.length - 1],
  }
}

export const phaseStatusOf = room => {
  if (room?.state === 'complete') return '已交付'
  if (room?.state === 'paused') return '已暂停'
  if (room?.state === 'stopped') return '已停止'
  if (room?.state === 'active') return '进行中'
  return '待开始'
}

const toneOf = room => (
  room?.state === 'complete' ? 'done'
    : room?.state === 'paused' || room?.state === 'stopped' ? 'quiet'
      : 'active'
)

const goalOf = room => stripAttachmentTags(room?.goal ?? '').trim()

const phaseRow = (phase, index, currentId, onOpenRoom) => h('li', {
  key: phase.id,
  className: 'crew-project-phase',
  'data-state': toneOf(phase),
  'data-current': phase.id === currentId ? 'true' : undefined,
},
h('button', {
  type: 'button',
  className: 'crew-project-phase-button',
  onClick: () => onOpenRoom(phase.id),
},
h('span', { className: 'crew-project-phase-index', 'aria-hidden': 'true' }, String(index + 1)),
h('span', { className: 'crew-project-phase-copy' },
  h('b', null, phase.name ?? `第 ${index + 1} 阶段`),
  goalOf(phase) === '' ? null : h('span', null, goalOf(phase))),
h('span', { className: 'crew-project-phase-state' }, phaseStatusOf(phase))))

export function ProjectView({ rooms, rootId, onClose, onOpenRoom, onFollowup = null }) {
  const trail = projectTrailOf(rooms, rootId)
  const currentId = trail?.current?.id ?? null
  const [nextGoal, setNextGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  useEffect(() => {
    setNextGoal('')
    setNote(null)
  }, [currentId])

  const nextPhase = async () => {
    const text = nextGoal.trim()
    if (text === '' || busy || typeof onFollowup !== 'function' || trail === null) return
    setBusy(true)
    setNote(null)
    try {
      const result = await onFollowup(trail.current.id, text)
      if (result?.room?.id === undefined || result.room.id === null) {
        setNote('下一阶段没能开起来，再试一次。')
        return
      }
      setNextGoal('')
    } catch {
      setNote('下一阶段没能开起来，再试一次。')
    } finally {
      setBusy(false)
    }
  }

  if (trail === null) {
    return h('main', { className: 'dsb-main crew-project' },
      h('div', { className: 'crew-project-inner' },
        h('button', { type: 'button', className: 'crew-link', onClick: onClose }, '← 回到房间'),
        h('h1', { className: 'crew-project-title' }, '项目还没连起来')))
  }

  const { root, phases, current } = trail
  const currentIndex = phases.length - 1
  const currentComplete = current?.state === 'complete'
  return h('main', { className: 'dsb-main crew-project' },
    h('div', { className: 'crew-project-inner' },
      h('button', { type: 'button', className: 'crew-link crew-project-back', onClick: onClose }, '← 回到房间'),
      h('p', { className: 'crew-project-kicker' }, '项目轨迹'),
      h('h1', { className: 'crew-project-title' }, root.name ?? '项目'),
      h('p', { className: 'crew-project-north' }, goalOf(root) || '还没有写北极星。'),
      h('p', { className: 'crew-project-count' }, `${phases.length} 个阶段 · 当前第 ${currentIndex + 1} 阶段`),
      h('ol', { className: 'crew-project-phases', 'aria-label': '阶段' },
        phases.map((phase, index) => phaseRow(phase, index, current.id, onOpenRoom))),
      h('section', { className: 'crew-project-current', 'aria-label': '当前阶段' },
        h('span', { className: 'crew-project-current-label' }, currentComplete ? '最后一间已交付' : '现在在这一间'),
        h('b', null, current.name ?? `第 ${currentIndex + 1} 阶段`),
        current.delivery?.changedFiles?.length > 0
          ? h('span', { className: 'crew-field-hint' }, `${current.delivery.changedFiles.length} 个文件的结果`)
          : null,
        current.completedAt
          ? h('span', { className: 'crew-field-hint' }, `交付于 ${dateTimeOf(current.completedAt)}`)
          : null,
        h('button', {
          type: 'button',
          className: 'crew-accept crew-project-open',
          onClick: () => onOpenRoom(current.id),
        }, currentComplete ? '打开最后一间工作室' : '打开当前阶段')),
      currentComplete
        ? onFollowup === null
          ? h('p', { className: 'crew-field-hint' }, '下一阶段在当前工作室里点发送旁的 ⌄，或结果卡里的「接着改」开。')
          : h('div', { className: 'crew-project-next' },
            h('label', { className: 'crew-project-next-label', htmlFor: 'crew-project-next-goal' }, '下一阶段要做什么？'),
            h('div', { className: 'crew-project-next-row' },
              h('input', {
                id: 'crew-project-next-goal',
                className: 'crew-goal-input',
                value: nextGoal,
                placeholder: '例如：把真实数据接进来',
                disabled: busy,
                onChange: event => setNextGoal(event.target.value),
                onKeyDown: event => {
                  if (event.key !== 'Enter' || event.shiftKey) return
                  event.preventDefault()
                  void nextPhase()
                },
              }),
              h('button', {
                type: 'button',
                className: 'crew-accept',
                disabled: busy || nextGoal.trim() === '',
                onClick: () => void nextPhase(),
              }, busy ? '正在开…' : '开下一阶段')),
            note === null ? null : h('p', { className: 'crew-field-hint', role: 'alert' }, note),
            h('p', { className: 'crew-field-hint' }, '原班人马和工作区沿用；旧版保留。'))
        : null))
}
