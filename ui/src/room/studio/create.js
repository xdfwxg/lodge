import { Fragment, createElement as h } from 'react'
import { EngineLogin } from '../../engine-login.js'
import { engineReadiness } from '../../../../shared/engine-readiness.js'
import { DEFAULT_STUDIO_ROSTER } from '../../../../shared/studio-roster.js'
import { MemberEnginePicker } from '../member-engine-picker.js'
import { normalizeMembers } from '../member-options.js'

export const DEFAULT_STUDIO_MEMBERS = normalizeMembers(DEFAULT_STUDIO_ROSTER)

const nameList = value => String(value ?? '')
  .split(/[,，\n]/)
  .map(item => item.trim())
  .filter(Boolean)

const memberRequests = (members, memberChoices, selectedModelOf) => members.map((member, index) => {
  const choice = memberChoices[index] ?? { engine: '', model: '' }
  const model = choice.model !== '' ? choice.model : selectedModelOf(choice)
  const skills = nameList(choice.skillsText)
  const mcp = nameList(choice.mcpText)
  return {
    role: member.role,
    name: member.name,
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
  memberChoices,
  hasMemberChoice,
  members,
  selectedModelOf,
}) => {
  const roster = Array.isArray(proposal?.members) && proposal.members.length > 0
    ? proposal.members
    : normalizeMembers(members)
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
    ...(handoff === null || handoff === undefined ? {} : { handoff }),
    ...(handoffReviewed ? { handoffReviewed: true } : {}),
    ...(typeof sourceRoomId === 'string' && sourceRoomId !== '' ? { sourceRoomId } : {}),
    ...(typeof sourceName === 'string' && sourceName !== '' ? { sourceName } : {}),
    ...((hasMemberChoice || (proposal !== null && proposal !== undefined)) && roster.length > 0
      ? { members: memberRequests(roster, memberChoices, selectedModelOf) }
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
  members = DEFAULT_STUDIO_MEMBERS,
  engines = [],
  onLogin = null,
  loginBusyId = '',
  loginNote = '',
  onRefresh = null,
  showVerify = true,
  verifyMode = 'manual',
  onVerifyMode = () => {},
  acceptanceDraft = '',
  onAcceptanceDraft = () => {},
  onAdvanced = () => {},
}) {
  const readiness = engineReadiness(engines, { requireApproval: true })
  const { installed, ready, loginTargets, manualLogin, noModels } = readiness
  const vendors = new Set(ready.map(item => item.engine ?? item.id))
  const modelNote = installed.length === 0
    ? '先装一个会先问你的模型。也可以先进聊天室讨论。'
    : ready.length === 0
      ? loginTargets.length + manualLogin.length > 0
        ? ''
        : noModels.length > 0
          ? `${noModels.map(item => item.name ?? item.id).join('、')}还没有模型。`
          : '还没有会先问你的模型，工作室开不了工。也可以先进聊天室讨论。'
      : vendors.size < 2
        ? '只有一家模型可用：复核会由同一家完成。'
        : ''
  const listed = normalizeMembers(members)
  const defaultTrio = listed.length === 3 &&
    ['lead', 'worker', 'verifier'].every(role => listed.some(member => member.role === role))
  return h(Fragment, null,
    h('div', { className: 'crew-field' },
      h('div', { className: 'crew-field-head' },
        h('b', null, '成员'),
        h('button', { type: 'button', className: 'crew-link', onClick: onAdvanced }, '调整成员与模型')),
      h('div', { className: 'crew-team-summary' },
        listed.map(member => h('span', {
          key: member.id ?? member.name,
          className: 'crew-team-chip',
          'data-role': member.role,
        }, member.name))),
      h('p', { className: 'crew-field-hint' }, defaultTrio
        ? '默认三人组：规划、执行、验收。'
        : '成员已调整。'),
      modelNote === '' ? null : h('p', { className: 'crew-field-hint', role: 'status' }, modelNote),
      h(EngineLogin, {
        readiness,
        busyId: loginBusyId,
        note: loginNote,
        onLogin,
        onRefresh,
      })),
    showVerify
      ? h('div', { className: 'crew-field' },
        h('b', null, '怎么验收'),
        h(VerifyChoice, { verifyMode, onVerifyMode, acceptanceDraft, onAcceptanceDraft }),
        h('p', { className: 'crew-field-hint' }, verifyMode === 'test'
          ? '每一步都会真的跑一遍，结果留在房间里。'
          : '成员做完，你来确认。'))
      : null)
}

export function StudioSetupFields({
  members = DEFAULT_STUDIO_MEMBERS,
  choices = [],
  setChoices = () => {},
  engines = [],
  onInteraction,
  shadowReview = false,
  onShadowReview = () => {},
  advisor = { available: false, host: '' },
  recommending = false,
  canRecommend = true,
  onRecommend = null,
  features = null,
}) {
  return h(Fragment, null,
    h('div', { className: 'crew-field' },
      h('b', null, '成员与模型'),
      h(MemberEnginePicker, {
        members: normalizeMembers(members),
        choices,
        setChoices,
        engines,
        allowCapabilities: true,
        allowSkills: features?.skillsLibrary === true,
        requireApprovalGate: true,
        onInteraction,
      })),
    h('label', { className: 'crew-check' },
      h('input', {
        type: 'checkbox',
        checked: advisor.available === true && shadowReview,
        disabled: advisor.available !== true,
        onChange: event => onShadowReview(event.target.checked),
      }),
      '第二意见：再请一位看看'),
    h('p', { className: 'crew-field-hint' }, advisor.available === true
      ? `结果和改动会发给${advisor.host === '' ? '外部' : ` ${advisor.host} `}，只供参考，不参与验收。`
      : '第二意见还没配置。'),
    onRecommend === null ? null : h('div', { className: 'crew-new-recommend' },
      h('button', {
        type: 'button',
        className: 'crew-ghost',
        disabled: recommending || !canRecommend,
        onClick: onRecommend,
      }, recommending ? '正在出方案…' : '先出方案'),
      h('p', { className: 'crew-field-hint' }, '多花一点时间，先看方案。')))
}
