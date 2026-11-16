import { createElement as h } from 'react'
import { EngineLogin } from '../../engine-login.js'
import { engineReadiness } from '../../../../shared/engine-readiness.js'
import { MemberEnginePicker } from '../member-engine-picker.js'

import { defaultPersonalityId, normalizeMembers, PERSONALITIES } from '../member-options.js'

export const buildChatRequest = ({
  goal,
  name,
  repoPath,
  chatTurnLimit,
  defaultMembers,
  choices,
  selectedModelOf,
  receipt,
  sourceRoomId,
  sourceName,
}) => {
  const members = normalizeMembers(defaultMembers).map((member, index) => {
    const choice = choices[index] ?? { engine: '', model: '' }
    const model = choice.model !== '' ? choice.model : selectedModelOf(choice)
    return {
      ...member,
      personality: choice.personality || member.personality || defaultPersonalityId(index),
      ...(choice.engine === '' ? {} : { engine: choice.engine }),
      ...(choice.engine === '' || model === '' ? {} : { model }),
    }
  })
  return {
    name,
    roomType: 'chat',
    verify: 'manual',
    acceptance: '',
    chatTurnLimit,
    repoPath,
    ...(receipt === null || receipt === undefined ? {} : { receipt }),
    ...(typeof sourceRoomId === 'string' && sourceRoomId !== '' ? { sourceRoomId } : {}),
    ...(typeof sourceName === 'string' && sourceName !== '' ? { sourceName } : {}),
    ...(members.length > 0 ? { members } : {}),
    goal,
  }
}

export function ChatPrimaryFields({
  engines = [],
  loginBusyId = '',
  loginNote = '',
  onLogin = null,
  onRefresh = null,
}) {
  const readiness = engineReadiness(engines)
  if (readiness.canStart) return null
  const missingNames = readiness.noModels.map(item => item.name ?? item.id).join('、')
  const needsLogin = readiness.loginTargets.length + readiness.manualLogin.length > 0
  return h('div', { className: 'crew-field' },
    readiness.installed.length === 0
      ? h('p', { className: 'crew-field-hint', role: 'status' }, '还没有可用的模型服务。先安装一家，再点“刷新”。')
      : !needsLogin && readiness.noModels.length > 0
        ? h('p', { className: 'crew-field-hint', role: 'status' }, `${missingNames}没有配置模型；先在模型服务里配置一个模型。`)
        : null,
    h(EngineLogin, {
      readiness,
      busyId: loginBusyId,
      note: loginNote,
      onLogin,
      onRefresh,
    }))
}

export function ChatSetupFields({
  turnLimit,
  onTurnLimit,
  onAddMember = () => {},
  canAddMember = true,
  onRemoveMember = null,
  canRemoveMember = null,
  members,
  choices,
  setChoices,
  engines,
  onInteraction,
}) {
  return h('div', { className: 'crew-chat-fields' },
    h('div', { className: 'crew-field crew-field-row crew-field-break' },
      h('b', null, '每轮发言上限'),
      h('input', {
        className: 'crew-goal-input crew-input-narrow',
        type: 'number',
        min: 1,
        max: 20,
        value: turnLimit,
        'aria-label': '每轮发言上限',
        onChange: event => onTurnLimit(Math.min(20, Math.max(1, Number(event.target.value) || 6))),
      })),
    h('div', { className: 'crew-field crew-field-block' },
      h('div', { className: 'crew-field-head' },
        h('b', null, '成员')),
      h('div', { className: 'crew-proposal-block' },
        h(MemberEnginePicker, {
          members: normalizeMembers(members),
          choices,
          setChoices,
          engines,
          personalities: PERSONALITIES,
          onRemove: onRemoveMember,
          canRemove: canRemoveMember !== null,
          canRemoveMember,
          onInteraction,
        }),
        h('button', {
          type: 'button',
          className: 'crew-member-add',
          disabled: !canAddMember,
          title: canAddMember ? '添加成员' : '最多 6 位成员',
          onClick: onAddMember,
        },
          h('span', { className: 'crew-member-add-plus', 'aria-hidden': 'true' }, '＋'),
          '添加成员'))))
}
