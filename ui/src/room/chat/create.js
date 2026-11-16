import { createElement as h } from 'react'
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
  loginBusy,
  onLogin,
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
          loginBusy,
          onLogin,
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
