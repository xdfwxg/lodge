// 两套独立状态机：聊天室和工作室互不发事件、不共享状态。
// 这里只做“状态 + 事件 + context → 下一状态/拒绝原因”的纯判断，不碰存储和 UI。

export const STUDIO_STATES = ['open', 'planned', 'executing', 'verifying', 'signed', 'rejected']
export const CHAT_STATES = ['discussing', 'summarizing', 'awaiting_decision', 'accepted']

const studioTable = {
  open: {
    plan_submitted: { to: 'planned' },
    start_execute: { to: 'executing', guard: () => true },
    stage_advanced: { to: 'planned', guard: () => true },
  },
  planned: {
    start_execute: { to: 'executing', guard: () => true },
    reject_plan: { to: 'rejected', guard: () => true },
    stage_advanced: { to: 'planned', guard: () => true },
    sign: {
      to: 'signed',
      guard: context => context.verdictPassed === true && context.human === true,
      reason: '签字需要 Verifier PASS 和人工确认',
    },
  },
  executing: {
    stage_advanced: { to: 'planned', guard: () => true },
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
    sign: {
      to: 'signed',
      guard: context => context.verdictPassed === true && context.human === true,
      reason: '签字需要 Verifier PASS 和人工确认',
    },
  },
  signed: {},
  rejected: {},
}

const chatTable = {
  discussing: {
    summarize: { to: 'summarizing', guard: () => true },
  },
  summarizing: {
    conclude: { to: 'awaiting_decision', guard: () => true },
  },
  awaiting_decision: {
    accept: { to: 'accepted', guard: () => true },
    continue_discuss: { to: 'discussing', guard: () => true },
  },
  accepted: {},
}

const move = (table, state, event, context) => {
  const from = typeof state === 'string' && state !== '' ? state : 'open'
  const row = table[from]
  if (row === undefined) return { ok: false, error: `未知状态：${from}` }
  const transition = row[event]
  if (transition === undefined) return { ok: false, error: `状态 ${from} 不接受事件 ${event}` }
  if (transition.guard && !transition.guard(context ?? {})) {
    return { ok: false, error: transition.reason ?? `状态 ${from} 不满足事件 ${event} 的守卫` }
  }
  return { ok: true, from, state: transition.to, changed: from !== transition.to }
}

export const transitionStudio = (state, event, context = {}) => move(studioTable, state, event, context)

export const transitionChat = (state, event, context = {}) => move(chatTable, state, event, context)

export const studioTransitionEvent = (result, event, actor = 'system', context = {}) => ({
  type: 'closure.transition',
  payload: {
    from: result.from,
    to: result.state,
    event,
    actor,
    ...(Object.keys(context).length === 0 ? {} : { context }),
  },
})

export const chatTransitionEvent = (result, event, actor = 'system') => ({
  type: 'chat.transition',
  payload: { from: result.from, to: result.state, event, actor },
})
