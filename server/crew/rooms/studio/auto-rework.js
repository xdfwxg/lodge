// 自动检查没通过后的重做循环：只在有证据说“还不行”时继续，而且有上限。
// 同一个失败原地打转、次数、时间或额度触顶，就停手交给用户。
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

export const nextAutoRework = ({ state, command, exit, output, room, now = Date.now() }) => {
  const signature = `${command}:${exit}:${failureSignature(output)}`
  const previous = state ?? { attempts: 0, firstAt: now, signature: '' }
  const attempts = previous.attempts + 1
  const firstAt = Number.isFinite(previous.firstAt) ? previous.firstAt : now
  const repeated = previous.signature !== '' && previous.signature === signature
  const budget = Number(room?.usage?.budgetMicroUsd ?? 0)
  const cost = Number(room?.usage?.costMicroUsd ?? 0)
  const reason = repeated
    ? 'same-failure'
    : attempts > MAX_AUTO_REWORKS
      ? 'attempts'
      : now - firstAt > AUTO_REWORK_WINDOW_MS
        ? 'time'
        : budget > 0 && cost >= budget
          ? 'budget'
          : ''
  return {
    retry: reason === '',
    reason,
    state: { attempts, firstAt, signature },
  }
}
