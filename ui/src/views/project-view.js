import { createElement as h, useEffect, useState } from 'react'
import { dateTimeOf } from '../view-format.js'
import { RoundList, orderedRounds, roundNameOf, roundStatusOf } from './round-list.js'

export function ProjectView({ projects = [], projectId, onClose, onOpenRoom, onStartRound = null }) {
  const project = (projects ?? []).find(item => item.id === projectId) ?? null
  const rounds = orderedRounds(project?.rounds ?? [])
  const latest = rounds[rounds.length - 1] ?? null
  const [nextGoal, setNextGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  useEffect(() => {
    setNextGoal('')
    setNote(null)
  }, [projectId, latest?.id])

  const nextRound = async () => {
    const text = nextGoal.trim()
    if (text === '' || busy || typeof onStartRound !== 'function' || latest === null) return
    setBusy(true)
    setNote(null)
    try {
      const result = await onStartRound(latest.roomId, text, { projectId })
      if (result?.room?.id === undefined || result.room.id === null) {
        setNote('下一轮没能开起来，再试一次。')
        return
      }
      setNextGoal('')
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

  const canStart = latest !== null &&
    !['planning', 'active'].includes(latest.status) &&
    onStartRound !== null
  return h('main', { className: 'dsb-main crew-project' },
    h('div', { className: 'crew-project-inner' },
      h('button', { type: 'button', className: 'crew-link crew-project-back', onClick: onClose }, '← 回到房间'),
      h('p', { className: 'crew-project-kicker' }, '项目'),
      h('h1', { className: 'crew-project-title' }, project.name ?? '未命名项目'),
      h('p', { className: 'crew-project-north' }, project.northStar || '还没有写北极星。'),
      h('p', { className: 'crew-project-count' }, `${rounds.length} 轮 · ${latest === null ? '还没有开始' : roundStatusOf(latest)}`),
      h(RoundList, { rounds, onOpenRound: onOpenRoom }),
      latest === null
        ? h('p', { className: 'crew-field-hint' }, '这个项目还没有轮次。')
        : h('section', { className: 'crew-project-current', 'aria-label': '最近一轮' },
          h('span', { className: 'crew-project-current-label' }, latest.status === 'completed' ? '最近一轮已交付' : '最近一轮'),
          h('b', null, roundNameOf(latest, rounds.length - 1)),
          latest.completedAt
            ? h('span', { className: 'crew-field-hint' }, `交付于 ${dateTimeOf(latest.completedAt)}`)
            : null,
          latest.completedCommit
            ? h('span', { className: 'crew-field-hint' }, `版本 ${String(latest.completedCommit).slice(0, 8)}`)
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
          note === null ? null : h('p', { className: 'crew-field-hint', role: 'alert' }, note),
          h('p', { className: 'crew-field-hint' }, '工作室、成员和工作区沿用；旧轮次保留。'))
        : null))
}
