import { createElement as h } from 'react'
import { SeatEnginePicker } from '../seat-engine-picker.js'

const normalizeSeats = seats => (Array.isArray(seats) ? seats : []).map(seat => ({
  role: seat.role,
  name: seat.name,
  ...(seat.engine ? { engine: seat.engine } : {}),
  ...(seat.model ? { model: seat.model } : {}),
}))

export const chatSeatChoicesFrom = seats => normalizeSeats(seats)
  .map(seat => ({ engine: seat.engine ?? '', model: seat.model ?? '' }))

export const buildChatRequest = ({
  goal,
  name,
  repoPath,
  chatTurnLimit,
  defaultSeats,
  choices,
  continueFrom,
  selectedModelOf,
}) => {
  const seats = normalizeSeats(defaultSeats).map((seat, index) => {
    const choice = choices[index] ?? { engine: '', model: '' }
    const model = choice.model !== '' ? choice.model : selectedModelOf(choice)
    return {
      ...seat,
      ...(choice.engine === '' ? {} : { engine: choice.engine }),
      ...(choice.engine === '' || model === '' ? {} : { model }),
    }
  })
  const hasChoice = choices.some(choice => choice.engine !== '' || choice.model !== '')
  return {
    name,
    roomType: 'chat',
    verify: 'manual',
    acceptance: '',
    chatTurnLimit,
    repoPath,
    ...(hasChoice ? { seats } : {}),
    ...(continueFrom === undefined || continueFrom === null ? {} : { continueFrom }),
    goal,
  }
}

export function ChatSetupFields({
  turnLimit,
  onTurnLimit,
  seats,
  choices,
  setChoices,
  engines,
  loginBusy,
  onLogin,
  onInteraction,
}) {
  return h('div', null,
    h('div', { className: 'crew-field' },
      h('div', { className: 'crew-field-head' },
        h('b', null, '每轮发言上限'),
        h('span', { className: 'crew-field-hint' }, '默认 6')),
      h('input', {
        className: 'crew-goal-input',
        type: 'number',
        min: 1,
        max: 20,
        value: turnLimit,
        onChange: event => onTurnLimit(Math.min(20, Math.max(1, Number(event.target.value) || 6))),
      }),
      h('p', { className: 'crew-field-hint' }, '达到上限后主持人总结，你认可或继续追加一轮。')),
    h('div', { className: 'crew-proposal-block' },
      h('b', null, '成员与模型'),
      h(SeatEnginePicker, {
        seats: normalizeSeats(seats),
        choices,
        setChoices,
        engines,
        loginBusy,
        onLogin,
        onInteraction,
      })))
}
