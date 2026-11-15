import { createStateMachine } from '../../room-state.js'

export const STUDIO_STATES = ['open', 'planned', 'executing', 'verifying', 'signed', 'rejected']
export const STUDIO_EVENTS = ['plan_submitted', 'start_execute', 'stage_advanced', 'await_sign', 'reject_plan', 'submit_evidence', 'verdict_pass', 'verdict_reject', 'sign', 'rewind']

const studioTable = {
  open: {
    plan_submitted: { to: 'planned' },
    start_execute: { to: 'executing', guard: context => context.hasPlan !== true },
    stage_advanced: { to: 'planned', guard: () => true },
    await_sign: { to: 'verifying', guard: () => true },
  },
  planned: {
    start_execute: { to: 'executing', guard: () => true },
    reject_plan: { to: 'rejected', guard: () => true },
    stage_advanced: { to: 'planned', guard: () => true },
    await_sign: { to: 'verifying', guard: () => true },
    rewind: { to: 'executing', guard: () => true },
  },
  executing: {
    stage_advanced: { to: 'planned', guard: () => true },
    await_sign: { to: 'verifying', guard: () => true },
    rewind: { to: 'executing', guard: () => true },
    submit_evidence: {
      to: 'verifying',
      guard: context => context.manual === true || context.exitCode === 0,
      reason: '验收命令未通过，不能进入复核',
    },
  },
  verifying: {
    verdict_pass: { to: 'verifying', guard: () => true },
    verdict_reject: { to: 'executing', guard: () => true },
    stage_advanced: { to: 'planned', guard: () => true },
    await_sign: { to: 'verifying', guard: () => true },
    rewind: { to: 'executing', guard: () => true },
    sign: {
      to: 'signed',
      guard: context => context.verdictPassed === true && context.human === true,
      reason: '签字需要验收席位通过和人工确认',
    },
  },
  signed: {},
  rejected: {},
}

const machine = createStateMachine(studioTable)

export const transitionStudio = machine.transition

export const studioTransitionEvent = (result, event, actor = 'system', context = {}, reason = '') => ({
  type: 'closure.transition',
  payload: {
    from: result.from,
    to: result.state,
    event,
    actor,
    ...(reason === '' ? {} : { reason }),
    ...(Object.keys(context).length === 0 ? {} : { context }),
  },
})
