import { ROUND_TRANSITIONS, TERMINAL_ROUND_STATUSES } from '../../../shared/states.js'

export const terminalRoundStatus = status => TERMINAL_ROUND_STATUSES.has(status)

// 轮次生命周期只走这一张表；房间状态不在这里改。
export const transitionRound = (from, event) => {
  const row = ROUND_TRANSITIONS[from]
  if (row === undefined) return { ok: false, error: '未知轮次状态' }
  const to = row[event]
  if (to === undefined) return { ok: false, error: '这一步不能这样结束' }
  return { ok: true, from, state: to }
}
