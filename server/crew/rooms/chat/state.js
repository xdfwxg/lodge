import { createStateMachine } from '../../room-state.js'
import { CHAT_EVENT, CHAT_PHASE, CHAT_TRANSITIONS } from '../../../../shared/states.js'

export const CHAT_STATES = Object.freeze(Object.values(CHAT_PHASE))
export const CHAT_EVENTS = Object.freeze(Object.values(CHAT_EVENT))

const chatTable = Object.fromEntries(
  Object.entries(CHAT_TRANSITIONS).map(([from, row]) => [
    from,
    Object.fromEntries(Object.entries(row).map(([event, to]) => [event, { to, guard: () => true }])),
  ]),
)

const machine = createStateMachine(chatTable)

export const transitionChat = machine.transition

export const replayChatTransition = machine.transition

export const chatTransitionEvent = (result, event, actor = 'system', reason = '') => ({
  type: 'chat.transition',
  payload: { from: result.from, to: result.state, event, actor, ...(reason === '' ? {} : { reason }) },
})
