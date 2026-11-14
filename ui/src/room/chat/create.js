import { createElement as h } from 'react'
import { SeatEnginePicker } from '../seat-engine-picker.js'

import { defaultPersonalityId, normalizeSeats, PERSONALITIES } from '../seat-options.js'

export const buildChatRequest = ({
  goal,
  name,
  repoPath,
  chatTurnLimit,
  defaultSeats,
  choices,
  selectedModelOf,
}) => {
  const seats = normalizeSeats(defaultSeats).map((seat, index) => {
    const choice = choices[index] ?? { engine: '', model: '' }
    const model = choice.model !== '' ? choice.model : selectedModelOf(choice)
    return {
      ...seat,
      personality: choice.personality || seat.personality || defaultPersonalityId(index),
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
    ...(seats.length > 0 ? { seats } : {}),
    goal,
  }
}

export function ChatSetupFields({
  turnLimit,
  onTurnLimit,
  onAddSeat = () => {},
  canAddSeat = true,
  onRemoveSeat = null,
  canRemoveSeat = null,
  seats,
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
        h('b', null, '成员配置')),
      h('div', { className: 'crew-proposal-block' },
        h(SeatEnginePicker, {
          seats: normalizeSeats(seats),
          choices,
          setChoices,
          engines,
          personalities: PERSONALITIES,
          onRemove: onRemoveSeat,
          canRemove: canRemoveSeat !== null,
          canRemoveSeat,
          loginBusy,
          onLogin,
          onInteraction,
        }),
        h('button', {
          type: 'button',
          className: 'crew-seat-add',
          disabled: !canAddSeat,
          title: canAddSeat ? '添加成员' : '最多 6 位成员',
          onClick: onAddSeat,
        },
          h('span', { className: 'crew-seat-add-plus', 'aria-hidden': 'true' }, '＋'),
          '添加成员'))))
}
