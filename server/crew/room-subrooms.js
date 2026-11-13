export const MAX_SUBROOM_DEPTH = 3

export const canCreateSubroom = room => (
  room?.roomType === 'studio' &&
  room.state === 'active' &&
  (room.depth ?? 0) < MAX_SUBROOM_DEPTH
)

export const childDepthOf = room => (room?.depth ?? 0) + 1

export const childVerdictsOf = messages => messages
  .filter(message => message.kind === 'verdict' && (message.meta?.roleKind ?? 'verifier') === 'verifier')
  .slice(-5)
  .map(message => ({
    pass: message.meta?.pass === true,
    text: String(message.text ?? '').slice(0, 500),
    stage: message.meta?.stage ?? null,
    mode: message.meta?.mode ?? 'agent',
  }))

export const childResultText = (child, verdicts) => {
  const lines = verdicts.map(item => `${item.pass ? 'PASS' : 'REJECT'}（阶段 ${(item.stage ?? 0) + 1}）${item.text}`)
  return [
    `子工作室「${child.name}」已 signed。`,
    ...(lines.length === 0 ? ['没有 Verifier verdict。'] : [`Verifier 结果：\n${lines.join('\n')}`]),
    '父 Planner 只依据这些 verdict 决定下一步，不重审子工作室细节。',
  ].join('\n')
}
