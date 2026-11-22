// 一张决策卡：一个问题、2–3 条路、每条路会发生什么、一条推荐。
// 工具、房间状态和界面共用这一份校验；不在聊天文本里解析选项。
export const DECISION_STATUS = Object.freeze({
  open: 'open',
  answered: 'answered',
  cancelled: 'cancelled',
})

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

export const normalizeAskDecision = ({
  id,
  roomId = null,
  roundId = null,
  stage = null,
  source = 'planner',
  input = null,
  at = Date.now(),
} = {}) => {
  const question = text(input?.question, 500)
  if (question === '') return { error: '决策卡要有一个问题。' }
  const raw = Array.isArray(input?.options) ? input.options : []
  if (raw.length < 2 || raw.length > 3) return { error: '决策卡要 2–3 个选项。' }
  const options = []
  const ids = new Set()
  for (const item of raw) {
    const optionId = text(item?.id, 40)
    const title = text(item?.title, 80)
    const effect = text(item?.effect, 240)
    if (optionId === '' || title === '' || effect === '') return { error: '每个选项都要有 id、title 和 effect。' }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(optionId)) return { error: `选项 id 只能用小写字母、数字和 -：${optionId}` }
    if (ids.has(optionId)) return { error: `选项 id 重复：${optionId}` }
    ids.add(optionId)
    options.push({ id: optionId, title, effect })
  }
  const recommended = text(input?.recommended, 40)
  if (recommended === '' || !ids.has(recommended)) return { error: '推荐项必须是其中一个选项 id。' }
  return {
    decision: {
      id: text(id, 80) || `decision-${at}`,
      roomId,
      roundId,
      stage: Number.isInteger(stage) ? stage : null,
      source,
      kind: 'ask',
      question,
      options,
      recommended,
      status: DECISION_STATUS.open,
      askedAt: at,
      answer: null,
    },
  }
}

export const answerDecision = (decision, optionId, at = Date.now()) => {
  if (decision === null || decision === undefined || decision.status !== DECISION_STATUS.open) {
    return { error: '这张决策卡已经不在等你了。' }
  }
  if (optionId === 'cancel') {
    return {
      decision: {
        ...decision,
        status: DECISION_STATUS.cancelled,
        answer: { optionId: 'cancel', effect: '先不做这一步', at },
      },
    }
  }
  const chosen = optionId === 'default'
    ? decision.options.find(option => option.id === decision.recommended)
    : decision.options.find(option => option.id === optionId)
  if (chosen === undefined) return { error: '这个选项不在决策卡里。' }
  return {
    decision: {
      ...decision,
      status: DECISION_STATUS.answered,
      answer: { optionId: chosen.id, effect: chosen.effect, at },
    },
  }
}
