import { createStateMachine } from '../../room-state.js'

export const CHAT_STATES = ['discussing', 'summarizing', 'awaiting_decision', 'accepted']
export const CHAT_EVENTS = ['summarize', 'conclude', 'accept', 'continue_discuss', 'abort']

const chatTable = {
  discussing: {
    summarize: { to: 'summarizing', guard: () => true },
    abort: { to: 'discussing', guard: () => true },
  },
  summarizing: {
    conclude: { to: 'awaiting_decision', guard: () => true },
    abort: { to: 'discussing', guard: () => true },
  },
  awaiting_decision: {
    accept: { to: 'accepted', guard: () => true },
    continue_discuss: { to: 'discussing', guard: () => true },
  },
  accepted: {},
}

const machine = createStateMachine(chatTable)

export const transitionChat = machine.transition

export const replayChatTransition = machine.transition

export const chatTransitionEvent = (result, event, actor = 'system', reason = '') => ({
  type: 'chat.transition',
  payload: { from: result.from, to: result.state, event, actor, ...(reason === '' ? {} : { reason }) },
})
