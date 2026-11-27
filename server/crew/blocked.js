// 「这一步为什么停住、该怎么说」是一份数据，不是一串 if：
// 加一种停因只在 BLOCKED_REASON 里加一个值、在这里加一句话；
// 写它的地方只写 reason，怎么说、算不算“等人”，都只有这里说了算。
import { BLOCKED_REASON } from '../../shared/states.js'
import { memberDisplayName } from './member-labels.js'

const workerNamesOf = (room, blocked) => (
  (Array.isArray(blocked?.workers) ? blocked.workers : []).map(id => memberDisplayName(room, id)).join('、')
)

const COPY = {
  // 平台自己会继续：停的是那一位成员，不是整步。
  [BLOCKED_REASON['read-boundary']]: { human: false },
  [BLOCKED_REASON.timeout]: {
    human: true,
    label: ({ names }) => (names === '' ? '执行超时' : `执行超时：${names}停下了`),
    detail: () => '退回重做，或叫停后重新派活。',
  },
  [BLOCKED_REASON.plan]: {
    human: true,
    label: () => '规划师还没给出方案',
    detail: () => '回一句“继续”，或把目标说清楚一点。',
  },
  [BLOCKED_REASON.setup]: {
    human: true,
    label: () => '组队没能开始',
    detail: () => '回一句“继续”再试一次；还不行就退回重来。',
  },
  [BLOCKED_REASON.boundary]: {
    human: true,
    label: () => '越界改动没能退回',
    detail: () => '退回重做，或叫停后重新派活。',
  },
}

// 没登记的理由不当成“执行超时”去糊弄：如实说“停住了”，人仍然有退回重做的出路。
const UNKNOWN = {
  human: true,
  label: () => '这一步停住了',
  detail: () => '退回重做，或叫停后重新派活。',
}

export const blockedCopyOf = reason => COPY[reason] ?? (reason === undefined ? null : UNKNOWN)

// 停下来要人处理时返回一条能直接显示的信号；不需要人（或没停）返回 null。
export const blockedSignalOf = room => {
  const blocked = room?.blocked
  const entry = blockedCopyOf(blocked?.reason)
  if (entry === null || entry.human === false) return null
  const ctx = { room, blocked, names: workerNamesOf(room, blocked), command: blocked?.command }
  return {
    kind: 'blocked',
    stage: Number.isInteger(blocked?.stage) ? blocked.stage : null,
    label: entry.label(ctx),
    detail: entry.detail(ctx),
  }
}

export const BLOCKED_COPY_REASONS = Object.freeze(Object.keys(COPY))
