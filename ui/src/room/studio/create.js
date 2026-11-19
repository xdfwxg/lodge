import { Fragment, createElement as h } from 'react'
import { Segmented } from '../../segmented.js'
import { ROOM_ACCESS_OPTIONS } from '../../../../shared/room-access.js'
import { EngineLogin } from '../../engine-login.js'
import { engineReadiness } from '../../../../shared/engine-readiness.js'
import { DEFAULT_STUDIO_ROSTER } from '../../../../shared/studio-roster.js'
import { MemberEnginePicker } from '../member-engine-picker.js'
import { normalizeMembers } from '../member-options.js'
import { RoleIcon } from '../role-icon.js'

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
  browser = false,
  roomAccess = 'ask',
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
      ...(typeof proposal.prose === 'string' && proposal.prose.trim() !== '' ? { prose: proposal.prose.trim() } : {}),
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
    ...(browser ? { browser: true } : {}),
    ...(browser ? { roomAccess } : {}),
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
    h(Segmented, {
      label: '怎么验收',
      value: verifyMode,
      onChange: onVerifyMode,
      disabled,
      options: [
        { value: 'manual', label: '我自己看' },
        { value: 'test', label: '跑一条检查' },
      ],
    }),
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
  return h(Fragment, null,
    h('div', { className: 'crew-field' },
      h('div', { className: 'crew-field-head' },
        h('b', null, '成员'),
        h('button', { type: 'button', className: 'crew-link', onClick: onAdvanced }, '调整成员')),
      h('div', { className: 'crew-team-summary' },
        listed.map(member => h('span', {
          key: member.id ?? member.name,
          className: 'crew-team-chip',
          'data-role': member.role,
        }, h(RoleIcon, { member }), member.name))),
      h('p', { className: 'crew-field-hint' }, '一人规划、一人执行、一人检查；需要时再换人或加人。'),
      modelNote === '' ? null : h('p', { className: 'crew-field-hint', role: 'status' }, modelNote),
      h(EngineLogin, {
        readiness,
        busyId: loginBusyId,
        note: loginNote,
        onLogin,
        onRefresh,
      })))
}

export function StudioSetupFields({
  members = DEFAULT_STUDIO_MEMBERS,
  choices = [],
  setChoices = () => {},
  engines = [],
  onInteraction,
  browser = false,
  onBrowser = () => {},
  roomAccess = 'ask',
  onRoomAccess = () => {},
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
    h('div', { className: 'crew-check-block' },
      h('label', { className: 'crew-check' },
        h('input', {
          type: 'checkbox',
          checked: browser === true,
          onChange: event => {
            const next = event.target.checked
            onBrowser(next)
            if (!next) onRoomAccess('ask')
          },
        }),
        '允许查公开网页'),
      h('p', { className: 'crew-field-hint' }, '只在独立的只读浏览器里查资料；不登录、不点击、不付款。')),
    browser === true
      ? h('div', { className: 'crew-field' },
        h('b', null, '查网页时'),
        h(Segmented, {
          label: '查网页时',
          value: roomAccess,
          options: ROOM_ACCESS_OPTIONS,
          onChange: onRoomAccess,
        }),
        h('p', { className: 'crew-field-hint' }, '每次确认会逐次问你；房间免确认只放行只读研究，命令、文件和付款仍要确认。'))
      : null)
}
