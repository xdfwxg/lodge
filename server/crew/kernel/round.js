import { ROUND_STATUS } from '../../../shared/work-round.js'

// 轮次生命周期只走这一张表；房间状态不在这里改。
const TABLE = Object.freeze({
  [ROUND_STATUS.planning]: Object.freeze({
    activate: ROUND_STATUS.active,
    reject: ROUND_STATUS.rejected,
    stop: ROUND_STATUS.stopped,
  }),
  [ROUND_STATUS.active]: Object.freeze({
    complete: ROUND_STATUS.completed,
    reject: ROUND_STATUS.rejected,
    fail: ROUND_STATUS.failed,
    supersede: ROUND_STATUS.superseded,
    stop: ROUND_STATUS.stopped,
  }),
  [ROUND_STATUS.completed]: Object.freeze({}),
  [ROUND_STATUS.rejected]: Object.freeze({}),
  [ROUND_STATUS.failed]: Object.freeze({}),
  [ROUND_STATUS.superseded]: Object.freeze({}),
  [ROUND_STATUS.stopped]: Object.freeze({}),
})

export const ROUND_EVENTS = Object.freeze(['activate', 'complete', 'reject', 'fail', 'supersede', 'stop'])

export const terminalRoundStatus = status => (
  status === ROUND_STATUS.completed ||
  status === ROUND_STATUS.rejected ||
  status === ROUND_STATUS.failed ||
  status === ROUND_STATUS.superseded ||
  status === ROUND_STATUS.stopped
)

export const transitionRound = (from, event) => {
  const row = TABLE[from]
  if (row === undefined) return { ok: false, error: '未知轮次状态' }
  const to = row[event]
  if (to === undefined) return { ok: false, error: '这一步不能这样结束' }
  return { ok: true, from, state: to }
}
