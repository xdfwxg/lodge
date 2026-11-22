// 先安静：只有真的等人处理的事才打扰，同一间房短时间不重复弹。
export const NOTIFY_COOLDOWN_MS = 5 * 60_000

export const NOTIFY_KINDS = Object.freeze([
  'approval',
  'question',
  'decision',
  'blocked',
  'budget',
  'error',
  'connection',
  'merge',
  'review-timeout',
  'setup',
  'signoff',
  'mcp',
  'result',
])

export const shouldNotify = ({
  attention,
  lastAt = 0,
  now = Date.now(),
  cooldown = NOTIFY_COOLDOWN_MS,
}) => {
  if (attention === null || attention === undefined) return false
  if (!NOTIFY_KINDS.includes(attention.kind)) return false
  return lastAt === 0 || now - lastAt >= cooldown
}
