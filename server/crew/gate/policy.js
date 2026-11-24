// Gate 只回答一件事：这份交接能不能进入工作室。
// 它不拆任务、不写方案、不调用模型；同一份输入永远得到同一个决定。
const RULES = [
  {
    code: 'handoff-brief-topic-missing',
    text: '交接简报缺少主题',
    fails: handoffBrief => typeof handoffBrief.topic !== 'string' || handoffBrief.topic.trim() === '',
  },
  {
    code: 'handoff-brief-disagreements-unreviewed',
    text: '交接简报还有未解决的分歧，待确认后再开工',
    fails: (handoffBrief, { humanReviewed }) => (
      Array.isArray(handoffBrief.disagreements) &&
      handoffBrief.disagreements.length > 0 &&
      humanReviewed !== true
    ),
  },
]

export const reviewRoomGate = ({ handoffBrief = null, humanReviewed = false } = {}) => {
  const issues = handoffBrief === null || handoffBrief === undefined
    ? []
    : RULES
      .filter(rule => rule.fails(handoffBrief, { humanReviewed }))
      .map(({ code, text }) => ({ code, text }))
  return {
    decision: issues.length === 0 ? 'allow' : 'reject',
    issues,
    needsHumanReview: handoffBrief !== null &&
      handoffBrief !== undefined &&
      Array.isArray(handoffBrief.disagreements) &&
      handoffBrief.disagreements.length > 0,
  }
}
