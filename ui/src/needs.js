// 只有真正等人动手的提醒才算 needsYou；验收中、验收通过这类只是进度。
export const needsAction = room => {
  const needs = room?.needsYou
  if (needs === null || needs === undefined) return null
  return needs.actionable === false ? null : needs
}

export const hasNeedsAction = room => needsAction(room) !== null
