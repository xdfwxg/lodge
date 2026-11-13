// 两套独立状态机：聊天室和工作室互不发事件、不共享状态。
// 这里只做“状态 + 事件 + context → 下一状态/拒绝原因”的纯判断，不碰存储和 UI。

export const STUDIO_STATES = ['open', 'planned', 'executing', 'verifying', 'signed', 'rejected']
export const CHAT_STATES = ['discussing', 'summarizing', 'awaiting_decision', 'accepted']
export const STUDIO_EVENTS = ['plan_submitted', 'start_execute', 'stage_advanced', 'await_sign', 'reject_plan', 'submit_evidence', 'verdict_pass', 'verdict_reject', 'sign']
export const CHAT_EVENTS = ['summarize', 'conclude', 'accept', 'continue_discuss', 'abort']

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
  },
  executing: {
    stage_advanced: { to: 'planned', guard: () => true },
    await_sign: { to: 'verifying', guard: () => true },
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

export const chatTransitionEvent = (result, event, actor = 'system', reason = '') => ({
  type: 'chat.transition',
  payload: { from: result.from, to: result.state, event, actor, ...(reason === '' ? {} : { reason }) },
})

// 只读回放：把审计事件按顺序校验成一条可展示的迁移链，不修改任何状态。
export const replayTransitions = ({ roomType, events, currentState = '' }) => {
  const chat = roomType === 'chat'
  const steps = (Array.isArray(events) ? events : []).map((item, index) => {
    const payload = item.payload ?? {}
    const issues = []
    if (index > 0) {
      const previous = events[index - 1]?.payload?.to
      if (payload.from !== previous) issues.push(`上一条结束于 ${previous ?? '?'}，本条从 ${payload.from ?? '?'} 开始`)
    }
    const moved = chat
      ? transitionChat(payload.from, payload.event)
      : transitionStudio(payload.from, payload.event, {
        manual: true,
        exitCode: 0,
        hasPlan: false,
        verdictPassed: true,
        human: true,
        ...(payload.context ?? {}),
      })
    if (!moved.ok) issues.push(moved.error)
    else if (moved.state !== payload.to) issues.push(`事件应到达 ${moved.state}，实际记录 ${payload.to}`)
    return {
      index: index + 1,
      id: item.id,
      at: item.at,
      from: payload.from ?? null,
      to: payload.to ?? null,
      event: payload.event ?? '',
      actor: payload.actor ?? '',
      reason: typeof payload.reason === 'string' ? payload.reason : '',
      context: payload.context !== null && typeof payload.context === 'object' ? payload.context : {},
      ok: issues.length === 0,
      issues,
    }
  })
  const finalState = steps.length === 0 ? currentState : steps.at(-1)?.to ?? currentState
  return {
    steps,
    summary: {
      total: steps.length,
      invalid: steps.filter(step => !step.ok).length,
      finalState,
    },
  }
}
