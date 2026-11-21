import { createElement as h, useEffect, useState } from 'react'
import { dateTimeOf } from '../view-format.js'
import { DecisionCard, DecisionOption } from '../room/decision-card.js'
import { RoundList, orderedRounds, roundNameOf, roundStatusOf } from './round-list.js'

export function ProjectView({ projects = [], rooms = [], projectId, onClose, onOpenRoom, onStartRound = null, onRecommend = null }) {
  const project = (projects ?? []).find(item => item.id === projectId) ?? null
  const rounds = orderedRounds(project?.rounds ?? [])
  const latest = rounds[rounds.length - 1] ?? null
  const [nextGoal, setNextGoal] = useState('')
  const [nextAcceptance, setNextAcceptance] = useState('')
  const [proposal, setProposal] = useState(null)
  const [answers, setAnswers] = useState([])
  const [busy, setBusy] = useState(false)
  const [proposing, setProposing] = useState(false)
  const [note, setNote] = useState(null)

  useEffect(() => {
    setNextGoal('')
    setNextAcceptance('')
    setProposal(null)
    setAnswers([])
    setNote(null)
  }, [projectId, latest?.id])

  const propose = async () => {
    const text = nextGoal.trim()
    const room = rooms.find(item => item.id === latest?.roomId) ?? null
    if (text === '' || proposing || latest === null || room === null || typeof onRecommend !== 'function') return
    setProposing(true)
    setNote(null)
    try {
      const result = await onRecommend(text, room.repoPath ?? '', null)
      if (result?.ok !== true || result.proposal === undefined) {
        setNote(result?.error ?? '没能给出方案，再试一次。')
        return
      }
      const nextProposal = result.proposal
      setProposal(nextProposal)
      setAnswers((nextProposal.questions ?? []).slice(0, 2).map(question => question.recommendation ?? ''))
      if (typeof nextProposal.acceptance === 'string' && nextProposal.acceptance !== '') {
        setNextAcceptance(nextProposal.acceptance)
      }
    } catch {
      setNote('没能给出方案，再试一次。')
    } finally {
      setProposing(false)
    }
  }

  const nextRound = async () => {
    const text = nextGoal.trim()
    const acceptance = nextAcceptance.trim()
    if (text === '' || busy || typeof onStartRound !== 'function' || latest === null) return
    const plan = proposal === null ? null : {
      done: proposal.done,
      ...(typeof proposal.prose === 'string' && proposal.prose.trim() !== '' ? { prose: proposal.prose.trim() } : {}),
      ...(typeof proposal.why === 'string' && proposal.why.trim() !== '' ? { why: proposal.why.trim() } : {}),
      ...(Array.isArray(proposal.stages) && proposal.stages.length > 0 ? { stages: proposal.stages } : {}),
      answers: (proposal.questions ?? []).slice(0, 2).map((question, index) => ({
        question: question.text,
        answer: answers[index] ?? question.recommendation ?? '',
      })),
    }
    setBusy(true)
    setNote(null)
    try {
      const result = await onStartRound(latest.roomId, text, {
        projectId,
        ...(plan === null ? {} : { plan }),
        ...(acceptance === '' ? {} : { verify: 'test', acceptance }),
      })
      if (result?.room?.id === undefined || result.room.id === null) {
        setNote('下一轮没能开起来，再试一次。')
        return
      }
      setNextGoal('')
      setNextAcceptance('')
      setProposal(null)
      setAnswers([])
    } catch {
      setNote('下一轮没能开起来，再试一次。')
    } finally {
      setBusy(false)
    }
  }

  const questions = proposal === null ? [] : (proposal.questions ?? []).slice(0, 2)
  const questionCards = questions.map((question, index) => h(DecisionCard, {
    key: `question-${index}`,
    kicker: '开工前决定',
    title: question.text,
    footer: index === questions.length - 1
      ? h('button', {
        type: 'button',
        className: 'crew-accept',
        disabled: busy || nextGoal.trim() === '',
        onClick: () => void nextRound(),
      }, busy ? '正在开…' : '开始这一轮')
      : null,
  },
  (question.options ?? []).length === 0
    ? h('div', { className: 'crew-decision-input' },
      h('input', {
        className: 'crew-goal-input',
        value: answers[index] ?? '',
        'aria-label': question.text,
        disabled: busy,
        onChange: event => {
          const next = [...answers]
          next[index] = event.target.value
          setAnswers(next)
        },
      }))
    : h('div', {
      className: 'crew-decision-options',
      role: 'radiogroup',
      'aria-label': question.text,
    },
    question.options.map(option => h(DecisionOption, {
      key: option.label,
      title: option.label,
      detail: option.cost ?? '',
      badge: option.label === question.recommendation ? '推荐' : '',
      selected: answers[index] === option.label,
      disabled: busy,
      onSelect: () => {
        const next = [...answers]
        next[index] = option.label
        setAnswers(next)
      },
    })))))

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
            questions.length > 0
              ? null
              : h('button', {
                type: 'button',
                className: 'crew-accept',
                disabled: busy || nextGoal.trim() === '',
                onClick: () => void nextRound(),
              }, busy ? '正在开…' : (proposal === null ? '开下一轮' : '开始这一轮')),
            onRecommend === null
              ? null
              : h('button', {
                type: 'button',
                className: 'crew-ghost',
                disabled: busy || proposing || nextGoal.trim() === '',
                onClick: () => void propose(),
              }, proposing ? '正在出方案…' : '先出方案')),
          proposal === null
            ? null
            : h('div', { className: 'crew-proposal-block', 'aria-label': '开工前决策' },
              h('b', null, '先定这几件事'),
              h('ul', null, (proposal.done ?? []).map((text, index) => h('li', { key: `done-${index}` }, text))),
              (proposal.stages ?? []).length === 0
                ? null
                : h('ol', null, proposal.stages.map((stage, index) => h('li', { key: `stage-${index}` },
                  `${stage.title}${stage.kind === 'decision' ? '（确认）' : ''}`)))),
          h('label', { className: 'crew-project-next-label', htmlFor: 'crew-project-next-acceptance' }, '验收命令（可不填）'),
          h('input', {
            id: 'crew-project-next-acceptance',
            className: 'crew-goal-input',
            value: nextAcceptance,
            placeholder: '例如：npm test；不填就由验收员看结果',
            disabled: busy,
            onChange: event => setNextAcceptance(event.target.value),
          }),
          questionCards,
          note === null ? null : h('p', { className: 'crew-field-hint', role: 'alert' }, note),
          h('p', { className: 'crew-field-hint' }, '工作室、成员和工作区沿用；旧轮次保留。'))
        : null))
}
