// 上一轮结论就是下一轮共同知道的东西；不再给每个人各背一份背景。
// 只读消息，不改状态；结论缺失时返回空串，由调用方只用话题。
const clip = (text, limit) => {
  const value = String(text ?? '').trim()
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

const joinList = list => (Array.isArray(list) ? list : [])
  .map(item => clip(item, 120))
  .filter(item => item !== '')
  .join('；')

export const chatBriefOf = (messages = [], { round = null, limit = 400 } = {}) => {
  const conclusions = (Array.isArray(messages) ? messages : [])
    .filter(message => (
      message?.kind === 'chat_conclusion' &&
      (round === null || message.meta?.round !== round)
    ))
  const conclusion = conclusions.at(-1)
  if (conclusion === undefined) return ''
  const handoff = conclusion.meta?.handoffBrief
  if (handoff !== null && typeof handoff === 'object') {
    const parts = [
      joinList(handoff.consensus) === '' ? '' : `共识：${joinList(handoff.consensus)}`,
      joinList(handoff.disagreements) === '' ? '' : `分歧：${joinList(handoff.disagreements)}`,
      joinList(handoff.unknowns) === '' ? '' : `未定：${joinList(handoff.unknowns)}`,
      joinList(handoff.constraints) === '' ? '' : `约束：${joinList(handoff.constraints)}`,
    ].filter(Boolean)
    if (parts.length > 0) return clip(parts.join('；'), limit)
  }
  return clip(conclusion.text, limit)
}
