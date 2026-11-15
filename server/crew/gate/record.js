// 留痕只记这次准入发生了什么：决定、原因、外部建议、检查方式，以及人有没有看过分歧。
export const gateRecordOf = ({ review, humanReviewed = false, advisor = {}, check = null }) => ({
  decision: review.decision,
  issues: review.issues,
  advice: review.advice,
  advisor: {
    available: advisor.available === true,
    ...(advisor.model === undefined ? {} : { model: advisor.model }),
    ...(advisor.version === undefined ? {} : { version: advisor.version }),
  },
  ...(check === null
    ? {}
    : {
      verification: {
        mode: check.mode === 'test' ? 'test' : 'manual',
        ...(typeof check.acceptance === 'string' && check.acceptance !== ''
          ? { command: check.acceptance }
          : {}),
      },
    }),
  at: Date.now(),
  // 只有确实需要人确认的分歧才留签字时间；没有分歧时不写空字段。
  ...(review.needsHumanReview
    ? { humanReviewed: humanReviewed === true, reviewedAt: humanReviewed === true ? Date.now() : null }
    : {}),
})
