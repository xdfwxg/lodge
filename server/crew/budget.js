const micro = usd => (usd === 0 ? 0 : Math.max(1, Math.round(usd * 1_000_000)))
const dollars = value => {
  const usd = value / 1_000_000
  return `$${usd >= 1 ? usd.toFixed(2) : usd.toFixed(3)}`
}

export const DEFAULT_ROOM_BUDGET_USD = 5

export const roomSpentMicroUsd = room => (
  Number.isFinite(room?.usage?.costMicroUsd) ? room.usage.costMicroUsd : 0
)

export const roomBudgetMicroUsd = room => (
  Number.isFinite(room?.usage?.budgetMicroUsd) ? room.usage.budgetMicroUsd : 0
)

export const globalBudgetMicroUsd = () => {
  const usd = Number(process.env.CREW_GLOBAL_BUDGET_USD)
  return Number.isFinite(usd) && usd > 0 ? micro(usd) : 0
}

export const globalSpentMicroUsd = rooms => (
  rooms.reduce((sum, room) => sum + roomSpentMicroUsd(room), 0)
)

// 0 表示不限；房间和全局都到阈值才算 blocked。只拦新任务，不杀正在跑的回合。
export const budgetStatus = (room, rooms = []) => {
  const spent = roomSpentMicroUsd(room)
  const budget = roomBudgetMicroUsd(room)
  const globalSpent = globalSpentMicroUsd(rooms)
  const globalBudget = globalBudgetMicroUsd()
  const roomBlocked = budget > 0 && spent >= budget
  const globalBlocked = globalBudget > 0 && globalSpent >= globalBudget
  return {
    ok: !roomBlocked && !globalBlocked,
    roomBlocked,
    globalBlocked,
    spent,
    budget,
    globalSpent,
    globalBudget,
    message: roomBlocked
      ? `房间预算已用尽（${dollars(spent)} / ${dollars(budget)}）`
      : globalBlocked
        ? `全局预算已用尽（${dollars(globalSpent)} / ${dollars(globalBudget)}）`
        : '',
  }
}

export const globalBudgetStatus = rooms => budgetStatus({}, rooms)

export const budgetHint = status => (
  status.globalBlocked
    ? '先调整全局预算（重启）或停止房间'
    : '先提高房间预算或停止房间'
)

export const budgetSummary = rooms => ({
  globalSpentMicroUsd: globalSpentMicroUsd(rooms),
  globalBudgetMicroUsd: globalBudgetMicroUsd(),
})

export const roomBudgetFromBody = body => {
  const explicit = Number(body?.budgetUsd)
  if (Number.isFinite(explicit) && explicit >= 0) return micro(explicit)
  const fallback = Number(process.env.CREW_ROOM_BUDGET_USD ?? DEFAULT_ROOM_BUDGET_USD)
  return micro(Number.isFinite(fallback) && fallback >= 0 ? fallback : DEFAULT_ROOM_BUDGET_USD)
}
