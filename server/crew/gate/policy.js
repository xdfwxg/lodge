// Gate 只回答一件事：这份交接能不能进入工作室。
// 它不拆任务、不写方案、不调用模型；同一份输入永远得到同一个决定。
const RULES = [
  {
    code: 'handoff-topic-missing',
    text: '交接单缺少主题',
    fails: handoff => typeof handoff.topic !== 'string' || handoff.topic.trim() === '',
  },
  {
    code: 'handoff-disagreements-unreviewed',
    text: '交接单还有未解决的分歧，需要你确认后再开工',
    fails: (handoff, { humanReviewed }) => (
      Array.isArray(handoff.disagreements) &&
      handoff.disagreements.length > 0 &&
      humanReviewed !== true
    ),
  },
]

export const reviewRoomGate = ({ handoff = null, humanReviewed = false, advice = [] } = {}) => {
  const issues = handoff === null || handoff === undefined
    ? []
    : RULES
      .filter(rule => rule.fails(handoff, { humanReviewed }))
      .map(({ code, text }) => ({ code, text }))
  return {
    decision: issues.length === 0 ? 'allow' : 'reject',
    issues,
    needsHumanReview: handoff !== null &&
      handoff !== undefined &&
      Array.isArray(handoff.disagreements) &&
      handoff.disagreements.length > 0,
    advice: Array.isArray(advice) ? advice : [],
  }
}
