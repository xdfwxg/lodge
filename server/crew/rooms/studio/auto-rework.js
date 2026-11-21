// 自动检查没通过后的重做循环：只在有证据说“还不行”时继续，而且有上限。
// 同一个失败原地打转、次数、时间或额度触顶，就停手交给用户。
import { AUTO_CHECK_REASON, AUTO_CHECK_STATUS } from '../../../../shared/states.js'

export const MAX_AUTO_REWORKS = 3
export const AUTO_REWORK_WINDOW_MS = 15 * 60_000

// 只看输出最后几行：同样的错误换个时间戳不算新进展。
export const failureSignature = output => String(output ?? '')
  .trim()
  .split('\n')
  .map(line => line.trim())
  .filter(line => line !== '')
  .slice(-5)
  .join('\n')

// 停下来时告诉人下一步：blocked 要人处理，limit-reached 可以再来一轮。
export const stopStatusOf = reason => (
  reason === AUTO_CHECK_REASON.time ? AUTO_CHECK_STATUS['limit-reached']
    : reason === AUTO_CHECK_REASON['same-failure'] || reason === AUTO_CHECK_REASON.attempts || reason === AUTO_CHECK_REASON.budget ? AUTO_CHECK_STATUS.blocked
      : ''
)

// 把前几次检查压成几行，作为重做时的进度账本；只取最后一条有内容的输出。
export const checkLedger = (checks, { startAt = 1, limit = 3 } = {}) => {
  const prior = checks.slice(-limit)
  if (prior.length === 0) return ''
  const lines = prior.map((message, offset) => {
    const last = String(message.meta?.output ?? '')
      .trim()
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '')
      .at(-1) ?? ''
    const command = String(message.meta?.command ?? '')
    const exit = message.meta?.exit ?? '?'
    return `- 第 ${startAt + offset} 次：${command} 退出码 ${exit}${last === '' ? '' : `；${last.slice(0, 120)}`}`
  })
  return `前几次检查：\n${lines.join('\n')}`
}

export const nextAutoRework = ({ state, command, exit, output, room, now = Date.now() }) => {
  const signature = `${command}:${exit}:${failureSignature(output)}`
  const previous = state ?? { attempts: 0, firstAt: now, signature: '' }
  const attempts = previous.attempts + 1
  const firstAt = Number.isFinite(previous.firstAt) ? previous.firstAt : now
  const repeated = previous.signature !== '' && previous.signature === signature
  const budget = Number(room?.usage?.budgetMicroUsd ?? 0)
  const cost = Number(room?.usage?.costMicroUsd ?? 0)
  const reason = repeated
    ? AUTO_CHECK_REASON['same-failure']
    : attempts > MAX_AUTO_REWORKS
      ? AUTO_CHECK_REASON.attempts
      : now - firstAt > AUTO_REWORK_WINDOW_MS
        ? AUTO_CHECK_REASON.time
        : budget > 0 && cost >= budget
          ? AUTO_CHECK_REASON.budget
          : ''
  return {
    retry: reason === '',
    reason,
    status: stopStatusOf(reason),
    state: { attempts, firstAt, signature },
  }
}
