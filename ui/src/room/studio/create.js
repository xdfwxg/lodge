import { Fragment, createElement as h } from 'react'
import { SeatEnginePicker } from '../seat-engine-picker.js'
import { normalizeSeats } from '../seat-options.js'

export const DEFAULT_STUDIO_SEATS = normalizeSeats([
  { role: 'lead', name: '规划师' },
  { role: 'worker', name: '执行官' },
  { role: 'verifier', name: '验收员' },
])

const nameList = value => String(value ?? '')
  .split(/[,，\n]/)
  .map(item => item.trim())
  .filter(Boolean)

const seatRequests = (seats, seatChoices, selectedModelOf) => seats.map((seat, index) => {
  const choice = seatChoices[index] ?? { engine: '', model: '' }
  const model = choice.model !== '' ? choice.model : selectedModelOf(choice)
  const skills = nameList(choice.skillsText)
  const mcp = nameList(choice.mcpText)
  return {
    role: seat.role,
    name: seat.name,
    ...(choice.engine === '' ? {} : { engine: choice.engine }),
    ...(choice.engine === '' || model === '' ? {} : { model }),
    ...(skills.length === 0 ? {} : { skills }),
    ...(mcp.length === 0 ? {} : {
      mcp: mcp.map(server => ({ server, scopes: ['read'], approval: 'ask' })),
    }),
  }
})

export const buildStudioRequest = ({
  name,
  repoPath,
  verify,
  acceptance,
  shadowReview,
  handoff,
  handoffReviewed = false,
  sourceRoomId,
  sourceName,
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
    ...(handoff === null || handoff === undefined ? {} : { handoff }),
    ...(handoffReviewed ? { handoffReviewed: true } : {}),
    ...(typeof sourceRoomId === 'string' && sourceRoomId !== '' ? { sourceRoomId } : {}),
    ...(typeof sourceName === 'string' && sourceName !== '' ? { sourceName } : {}),
    ...(shadowReview ? { shadowReview: true } : {}),
    ...((hasSeatChoice || (proposal !== null && proposal !== undefined)) && roster.length > 0
      ? { seats: seatRequests(roster, seatChoices, selectedModelOf) }
      : {}),
    ...(plan === null ? {} : { plan }),
  }
}

export function VerifyChoice({
  verifyMode = 'manual',
  onVerifyMode = () => {},
  acceptanceDraft = '',
  onAcceptanceDraft = () => {},
  disabled = false,
}) {
  return h(Fragment, null,
    h('div', { className: 'crew-choice-row', role: 'group', 'aria-label': '怎么验收' },
      h('button', {
        type: 'button',
        className: 'crew-choice',
        'data-on': verifyMode === 'manual' ? 'true' : undefined,
        'aria-pressed': verifyMode === 'manual',
        disabled,
        onClick: () => onVerifyMode('manual'),
      }, '我自己看'),
      h('button', {
        type: 'button',
        className: 'crew-choice',
        'data-on': verifyMode === 'test' ? 'true' : undefined,
        'aria-pressed': verifyMode === 'test',
        disabled,
        onClick: () => onVerifyMode('test'),
      }, '跑一条检查')),
    verifyMode === 'test'
      ? h('input', {
        className: 'crew-goal-input',
        type: 'text',
        'aria-label': '要跑的检查',
        placeholder: '例如：npm test',
        value: acceptanceDraft,
        disabled,
        onChange: event => onAcceptanceDraft(event.target.value),
      })
      : null)
}

export function StudioPrimaryFields({
  seats = DEFAULT_STUDIO_SEATS,
  showVerify = true,
  verifyMode = 'manual',
  onVerifyMode = () => {},
  acceptanceDraft = '',
  onAcceptanceDraft = () => {},
  onAdvanced = () => {},
}) {
  return h(Fragment, null,
    h('div', { className: 'crew-field' },
      h('div', { className: 'crew-field-head' },
        h('b', null, '成员'),
        h('button', { type: 'button', className: 'crew-link', onClick: onAdvanced }, '调整成员与模型')),
      h('div', { className: 'crew-team-summary' },
        normalizeSeats(seats).map(seat => h('span', {
          key: seat.id ?? seat.name,
          className: 'crew-team-chip',
          'data-role': seat.role,
        }, seat.name))),
      h('p', { className: 'crew-field-hint' }, '默认三人组：规划、执行、验收。')),
    showVerify
      ? h('div', { className: 'crew-field' },
        h('b', null, '怎么验收'),
        h(VerifyChoice, { verifyMode, onVerifyMode, acceptanceDraft, onAcceptanceDraft }),
        h('p', { className: 'crew-field-hint' }, verifyMode === 'test'
          ? '会在房间的工作文件夹里真的跑一遍，结果显示在交付卡上。'
          : '成员做完后由你确认；想自动检查，就选「跑一条检查」。'))
      : null)
}

export function StudioSetupFields({
  seats = DEFAULT_STUDIO_SEATS,
  choices = [],
  setChoices = () => {},
  engines = [],
  loginBusy = false,
  onLogin,
  onInteraction,
  shadowReview = false,
  onShadowReview = () => {},
  recommending = false,
  canRecommend = true,
  onRecommend = null,
  features = null,
}) {
  return h(Fragment, null,
    h('div', { className: 'crew-field' },
      h('b', null, '成员与模型'),
      h(SeatEnginePicker, {
        seats: normalizeSeats(seats),
        choices,
        setChoices,
        engines,
        loginBusy,
        allowCapabilities: true,
        allowSkills: features?.skillsLibrary === true,
        onLogin,
        onInteraction,
      })),
    h('label', { className: 'crew-check' },
      h('input', {
        type: 'checkbox',
        checked: shadowReview,
        onChange: event => onShadowReview(event.target.checked),
      }),
      '第二意见：再让一个模型独立看一遍'),
    h('p', { className: 'crew-field-hint' }, '多一份独立判断，供你对照。'),
    onRecommend === null ? null : h('div', { className: 'crew-new-recommend' },
      h('button', {
        type: 'button',
        className: 'crew-ghost',
        disabled: recommending || !canRecommend,
        onClick: onRecommend,
      }, recommending ? '正在出方案…' : '先让 Lodge 出方案'),
      h('p', { className: 'crew-field-hint' }, '会多花一点时间，给你方案和验收建议。')))
}
