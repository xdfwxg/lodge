import { createElement as h } from 'react'
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

export function ProjectView({ rooms, rootId, onClose, onOpenRoom }) {
  const trail = projectTrailOf(rooms, rootId)
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
        ? h('p', { className: 'crew-field-hint' }, '下一阶段在当前工作室里点「接着改」开。')
        : null))
}
