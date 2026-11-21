import { createElement as h, useEffect, useState } from 'react'
import { stripAttachmentTags } from '../../../shared/attachments.js'
import { dateTimeOf } from '../view-format.js'

export const roundStatusOf = round => {
  if (round?.status === 'completed') return '已交付'
  if (round?.status === 'active') return '进行中'
  if (round?.status === 'planning') return '待决定'
  if (round?.status === 'rejected') return '已退回'
  if (round?.status === 'superseded') return '已作废'
  if (round?.status === 'stopped') return '已停止'
  return '待开始'
}

const toneOf = round => (
  round?.status === 'completed' ? 'done'
    : ['rejected', 'superseded', 'stopped'].includes(round?.status) ? 'quiet'
      : 'active'
)

const goalOf = round => stripAttachmentTags(round?.goal ?? '').trim()
const roundNameOf = (round, index) => round?.name || round?.goal || `第 ${index + 1} 轮`
const orderedRounds = rounds => [...(rounds ?? [])].sort((a, b) => (
  (a.ordinal ?? 0) - (b.ordinal ?? 0) || (a.startedAt ?? 0) - (b.startedAt ?? 0)
))

const roundRow = (round, index, onOpenRoom) => h('li', {
  key: round.id,
  className: 'crew-project-phase',
  'data-state': toneOf(round),
},
h('button', {
  type: 'button',
  className: 'crew-project-phase-button',
  onClick: () => onOpenRoom(round.roomId),
},
h('span', { className: 'crew-project-phase-index', 'aria-hidden': 'true' }, String(round.ordinal ?? index + 1)),
h('span', { className: 'crew-project-phase-copy' },
  h('b', null, roundNameOf(round, index)),
  goalOf(round) === '' ? null : h('span', null, goalOf(round))),
h('span', { className: 'crew-project-phase-state' }, roundStatusOf(round))))

export function ProjectView({ projects = [], rooms = [], projectId, onClose, onOpenRoom, onFollowup = null }) {
  const project = (projects ?? []).find(item => item.id === projectId) ?? null
  const rounds = orderedRounds(project?.rounds ?? [])
  const latest = rounds[rounds.length - 1] ?? null
  const [nextGoal, setNextGoal] = useState('')
  const [nextAcceptance, setNextAcceptance] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  useEffect(() => {
    setNextGoal('')
    setNextAcceptance('')
    setNote(null)
  }, [projectId, latest?.id])

  const nextRound = async () => {
    const text = nextGoal.trim()
    const acceptance = nextAcceptance.trim()
    if (text === '' || busy || typeof onFollowup !== 'function' || latest === null) return
    setBusy(true)
    setNote(null)
    try {
      const result = await onFollowup(latest.roomId, text, acceptance === ''
        ? { projectId }
        : { projectId, verify: 'test', acceptance })
      if (result?.room?.id === undefined || result.room.id === null) {
        setNote('下一轮没能开起来，再试一次。')
        return
      }
      setNextGoal('')
      setNextAcceptance('')
    } catch {
      setNote('下一轮没能开起来，再试一次。')
    } finally {
      setBusy(false)
    }
  }

  if (project === null) {
    return h('main', { className: 'dsb-main crew-project' },
      h('div', { className: 'crew-project-inner' },
        h('button', { type: 'button', className: 'crew-link', onClick: onClose }, '← 回到房间'),
        h('h1', { className: 'crew-project-title' }, '项目还没连起来')))
  }

  const canStart = latest !== null && latest.status === 'completed' && onFollowup !== null
  return h('main', { className: 'dsb-main crew-project' },
    h('div', { className: 'crew-project-inner' },
      h('button', { type: 'button', className: 'crew-link crew-project-back', onClick: onClose }, '← 回到房间'),
      h('p', { className: 'crew-project-kicker' }, '项目'),
      h('h1', { className: 'crew-project-title' }, project.name ?? '未命名项目'),
      h('p', { className: 'crew-project-north' }, project.northStar || '还没有写北极星。'),
      h('p', { className: 'crew-project-count' }, `${rounds.length} 轮 · ${latest === null ? '还没有开始' : roundStatusOf(latest)}`),
      h('ol', { className: 'crew-project-phases', 'aria-label': '轮次' },
        rounds.map((round, index) => roundRow(round, index, onOpenRoom))),
      latest === null
        ? h('p', { className: 'crew-field-hint' }, '这个项目还没有轮次。')
        : h('section', { className: 'crew-project-current', 'aria-label': '最近一轮' },
          h('span', { className: 'crew-project-current-label' }, latest.status === 'completed' ? '最近一轮已交付' : '最近一轮'),
          h('b', null, roundNameOf(latest, rounds.length - 1)),
          latest.completedAt
            ? h('span', { className: 'crew-field-hint' }, `交付于 ${dateTimeOf(latest.completedAt)}`)
            : null,
          latest.completedCommit
            ? h('span', { className: 'crew-field-hint' }, `提交 ${String(latest.completedCommit).slice(0, 8)}`)
            : null,
          h('button', {
            type: 'button',
            className: 'crew-accept crew-project-open',
            onClick: () => onOpenRoom(latest.roomId),
          }, '打开这一轮的工作室')),
      canStart
        ? h('div', { className: 'crew-project-next' },
          h('label', { className: 'crew-project-next-label', htmlFor: 'crew-project-next-goal' }, '下一轮要做什么？'),
          h('div', { className: 'crew-project-next-row' },
            h('input', {
              id: 'crew-project-next-goal',
              className: 'crew-goal-input',
              value: nextGoal,
              placeholder: '例如：修掉登录超时',
              disabled: busy,
              onChange: event => setNextGoal(event.target.value),
              onKeyDown: event => {
                if (event.key !== 'Enter' || event.shiftKey) return
                event.preventDefault()
                void nextRound()
              },
            }),
            h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: busy || nextGoal.trim() === '',
              onClick: () => void nextRound(),
            }, busy ? '正在开…' : '开下一轮')),
          h('label', { className: 'crew-project-next-label', htmlFor: 'crew-project-next-acceptance' }, '验收命令（可不填）'),
          h('input', {
            id: 'crew-project-next-acceptance',
            className: 'crew-goal-input',
            value: nextAcceptance,
            placeholder: '例如：npm test；不填就由验收员看结果',
            disabled: busy,
            onChange: event => setNextAcceptance(event.target.value),
          }),
          note === null ? null : h('p', { className: 'crew-field-hint', role: 'alert' }, note),
          h('p', { className: 'crew-field-hint' }, '工作室、成员和工作区沿用；旧轮次保留。'))
        : null))
}
