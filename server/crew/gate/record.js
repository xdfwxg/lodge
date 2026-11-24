// 留痕只记这次准入发生了什么：决定、原因，以及人有没有看过分歧。
export const gateRecordOf = ({ review, humanReviewed = false }) => ({
  decision: review.decision,
  issues: review.issues,
  at: Date.now(),
  // 只有确实需要人确认的分歧才留确认时间；没有分歧时不写空字段。
  ...(review.needsHumanReview
    ? { humanReviewed: humanReviewed === true, reviewedAt: humanReviewed === true ? Date.now() : null }
    : {}),
})
