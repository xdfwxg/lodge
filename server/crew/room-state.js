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
