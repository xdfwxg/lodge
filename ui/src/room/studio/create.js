import { Fragment, createElement as h } from 'react'
import { SeatEnginePicker } from '../seat-engine-picker.js'
import { normalizeSeats } from '../seat-options.js'

export const DEFAULT_STUDIO_SEATS = normalizeSeats([
  { role: 'lead', name: '规划师' },
  { role: 'worker', name: '执行官' },
  { role: 'verifier', name: '验收员' },
])

const seatRequests = (seats, seatChoices, selectedModelOf) => seats.map((seat, index) => {
  const choice = seatChoices[index] ?? { engine: '', model: '' }
  const model = choice.model !== '' ? choice.model : selectedModelOf(choice)
  return {
    role: seat.role,
    name: seat.name,
    ...(choice.engine === '' ? {} : { engine: choice.engine }),
    ...(choice.engine === '' || model === '' ? {} : { model }),
  }
})

export const buildStudioRequest = ({
  name,
  repoPath,
  verify,
  acceptance,
  shadowReview,
  proposal,
  answers,
  seatChoices,
  hasSeatChoice,
  seats,
  selectedModelOf,
}) => {
  const roster = Array.isArray(proposal?.seats) && proposal.seats.length > 0
    ? proposal.seats
    : normalizeSeats(seats)
  const plan = proposal === null || proposal === undefined
    ? null
    : {
      done: proposal.done,
      ...(typeof proposal.orchestration === 'string' ? { orchestration: proposal.orchestration } : {}),
      ...(typeof proposal.why === 'string' && proposal.why !== '' ? { why: proposal.why } : {}),
      ...(Array.isArray(proposal.stages) && proposal.stages.length > 0 ? { stages: proposal.stages } : {}),
      answers: (proposal.questions ?? []).map((question, index) => ({
        question: question.text,
        answer: answers[index] ?? question.recommendation,
      })),
    }
  const resolvedVerify = proposal === null || proposal === undefined
    ? verify
    : proposal.verify === 'manual' ? 'manual' : 'test'
  return {
    name,
    roomType: 'studio',
    verify: resolvedVerify,
    acceptance,
    repoPath,
    ...(shadowReview ? { shadowReview: true } : {}),
    ...((hasSeatChoice || (proposal !== null && proposal !== undefined)) && roster.length > 0
      ? { seats: seatRequests(roster, seatChoices, selectedModelOf) }
      : {}),
    ...(plan === null ? {} : { plan }),
  }
}

export function StudioSetupFields({
  seats = DEFAULT_STUDIO_SEATS,
  choices = [],
  setChoices = () => {},
  engines = [],
  loginBusy = false,
  onLogin,
  onInteraction,
  verifyMode = 'manual',
  onVerifyMode = () => {},
  acceptanceDraft = '',
  onAcceptanceDraft = () => {},
  shadowReview = false,
  onShadowReview = () => {},
  recommending = false,
  canRecommend = true,
  onRecommend = null,
}) {
  return h(Fragment, null,
    h('div', { className: 'crew-field' },
      h('b', null, '团队'),
      h('p', { className: 'crew-field-hint' }, '默认：规划师、执行官、验收员'),
      h('details', { className: 'crew-dev-options' },
        h('summary', null, '换人或换模型'),
        h(SeatEnginePicker, {
          seats: normalizeSeats(seats),
          choices,
          setChoices,
          engines,
          loginBusy,
          onLogin,
          onInteraction,
        }))),
    h('div', { className: 'crew-field' },
      h('b', null, '验收'),
      h('div', { className: 'crew-choice-row', role: 'group', 'aria-label': '验收方式' },
        h('button', {
          type: 'button',
          className: 'crew-choice',
          'data-on': verifyMode === 'manual' ? 'true' : undefined,
          'aria-pressed': verifyMode === 'manual',
          onClick: () => onVerifyMode('manual'),
        }, '我自己看'),
        h('button', {
          type: 'button',
          className: 'crew-choice',
          'data-on': verifyMode === 'test' ? 'true' : undefined,
          'aria-pressed': verifyMode === 'test',
          onClick: () => onVerifyMode('test'),
        }, '跑一条检查')),
      verifyMode === 'test'
        ? h('input', {
          className: 'crew-goal-input',
          type: 'text',
          'aria-label': '检查命令',
          placeholder: '例如：npm test',
          value: acceptanceDraft,
          onChange: event => onAcceptanceDraft(event.target.value),
        })
        : null,
      h('p', { className: 'crew-field-hint' }, verifyMode === 'test'
        ? '会在房间工作区里真实运行，结果显示在交付卡上。'
        : '成员做完后由你确认；想自动检查就选右边。')),
    h('label', { className: 'crew-check' },
      h('input', {
        type: 'checkbox',
        checked: shadowReview,
        onChange: event => onShadowReview(event.target.checked),
      }),
      '第二意见：额外记录一份独立判断'),
    onRecommend === null ? null : h('div', { className: 'crew-new-recommend' },
      h('button', {
        type: 'button',
        className: 'crew-ghost',
        disabled: recommending || !canRecommend,
        onClick: onRecommend,
      }, recommending ? '正在排…' : '先让 Lodge 排一版'),
      h('p', { className: 'crew-field-hint' }, '会多花一点时间，给你阶段和验收建议。')))
}
