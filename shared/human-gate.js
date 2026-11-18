// 人工门只按当前状态暴露动作；界面不再各自猜“这一步能不能通过/重做”。
export const GATE_ACTION_LABELS = Object.freeze({
  pass: '通过',
  rework: '退回并重跑',
  retry: '重试',
  continue: '继续',
  'manual-pass': '人工通过',
  rewind: '退回指定步骤',
  'no-retry': '不重试',
})

export const humanGateActionsOf = ({
  state = 'open',
  canPass = false,
  canRework = false,
  canRetry = false,
  canContinue = false,
  canManualPass = false,
  canRewind = false,
  canNoRetry = false,
} = {}) => {
  if (state !== 'open') return []
  const allowed = { canPass, canRework, canRetry, canContinue, canManualPass, canRewind, canNoRetry }
  return Object.entries({
    pass: allowed.canPass,
    rework: allowed.canRework,
    retry: allowed.canRetry,
    continue: allowed.canContinue,
    'manual-pass': allowed.canManualPass,
    rewind: allowed.canRewind,
    'no-retry': allowed.canNoRetry,
  })
    .filter(([, on]) => on === true)
    .map(([id]) => ({ id, label: GATE_ACTION_LABELS[id] }))
}
