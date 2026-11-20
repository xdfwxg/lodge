import { roomModeOfRoom } from '../kinds.js'
import { transitionAssignment } from '../../assignments.js'
import { verdictPassed } from '../../../../shared/judgment.js'

export const MAX_SUBROOM_DEPTH = 3

export const canCreateSubroom = room => (
  roomModeOfRoom(room)?.supportsSubrooms === true &&
  room.state === 'active' &&
  (room.depth ?? 0) < MAX_SUBROOM_DEPTH
)

export const childVerdictsOf = messages => messages
  .filter(message => message.kind === 'verdict' && (message.meta?.roleKind ?? 'verifier') === 'verifier')
  .slice(-5)
  .map(message => ({
    pass: verdictPassed(message),
    text: String(message.text ?? '').slice(0, 500),
    stage: message.meta?.stage ?? null,
    mode: message.meta?.mode ?? 'agent',
  }))

export const childResultText = (child, verdicts) => {
  const lines = verdicts.map(item => `${item.pass ? 'PASS' : 'REJECT'}（阶段 ${(item.stage ?? 0) + 1}）${item.text}`)
  return [
    `子房间「${child.name}」已交付。`,
    ...(lines.length === 0 ? ['没有 Verifier verdict。'] : [`Verifier 结果：\n${lines.join('\n')}`]),
    '父 Planner 只依据这些 verdict 决定下一步，不重审子房间细节。',
  ].join('\n')
}

export const parentAssignmentOf = (store, parent, child) => {
  if (typeof child?.parentAssignmentId === 'string' && child.parentAssignmentId !== '') {
    return store.readAssignment(child.parentAssignmentId, parent.id) ?? null
  }
  return store.readAssignments(parent.id, { limit: 5000 })
    .filter(item => item.reason === 'subroom' && item.context?.childRoomId === child.id)
    .at(-1)
    ?? null
}

export const settleSubroomAssignment = ({ store, parent, child, resultText = '', verdictMessages = [] }) => {
  const assignment = parentAssignmentOf(store, parent, child)
  if (assignment === null) return null
  if (['passed', 'failed', 'rejected', 'cancelled'].includes(assignment.status)) return null
  return transitionAssignment(store, assignment.id, 'passed', {
    resultText: String(resultText ?? '').slice(0, 4000),
    evidenceIds: verdictMessages.map(message => message.id).filter(Boolean).slice(-10),
  })
}

// 重启或漏通知时补收口：子房已经交付，父房的子房交接就不该还开着。
export const settleCompletedSubrooms = (store, roomId) => {
  const parent = store.readRoom(roomId)
  if (parent === null) return 0
  let settled = 0
  for (const childId of parent.childRoomIds ?? []) {
    const child = store.readRoom(childId)
    if (child?.state !== 'complete') continue
    const verdictMessages = store.readMessages(childId)
      .filter(message => message.kind === 'verdict' && (message.meta?.roleKind ?? 'verifier') === 'verifier')
    const assignment = settleSubroomAssignment({
      store,
      parent,
      child,
      resultText: childResultText(child, childVerdictsOf(store.readMessages(childId))),
      verdictMessages,
    })
    if (assignment?.status === 'passed') settled += 1
  }
  return settled
}
