// 通用状态机机制：状态 + 事件 + context → 下一状态/拒绝原因。
// 具体状态表归房型模式所有；这里不认识任何房型，也不碰存储和 UI。

const move = (table, state, event, context) => {
  const from = typeof state === 'string' && state !== '' ? state : Object.keys(table)[0] ?? ''
  const row = table[from]
  if (row === undefined) return { ok: false, error: `未知状态：${from}` }
  const transition = row[event]
  if (transition === undefined) return { ok: false, error: `状态 ${from} 不接受事件 ${event}` }
  if (transition.guard && !transition.guard(context ?? {})) {
    return { ok: false, error: transition.reason ?? `状态 ${from} 不满足事件 ${event} 的守卫` }
  }
  return { ok: true, from, state: transition.to, changed: from !== transition.to }
}

export const createStateMachine = table => ({
  table,
  transition: (state, event, context = {}) => move(table, state, event, context),
})

// 只读回放：把审计事件按顺序校验成一条可展示的迁移链，不修改任何状态。
export const replayTransitions = ({ events, currentState = '', machine }) => {
  const steps = (Array.isArray(events) ? events : []).map((item, index) => {
    const payload = item.payload ?? {}
    const issues = []
    if (index > 0) {
      const previous = events[index - 1]?.payload?.to
      if (payload.from !== previous) issues.push(`上一条结束于 ${previous ?? '?'}，本条从 ${payload.from ?? '?'} 开始`)
    }
    const moved = machine(payload.from, payload.event, payload)
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
