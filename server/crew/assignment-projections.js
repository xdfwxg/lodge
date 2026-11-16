import { isWorkAssignment } from './assignments.js'

// 派发状态和阶段任务都是 Assignment 的投影，不写回房间。
export const dispatchFrom = (assignments, stageIndex) => {
  const list = (assignments ?? []).filter(item => item.stageIndex === stageIndex && isWorkAssignment(item))
  if (list.length === 0) return null
  const latestByMember = new Map()
  for (const item of list) latestByMember.set(item.toMemberId, item)
  const items = [...latestByMember.values()]
  const workers = items.map(item => item.toMemberId)
  const pending = items
    .filter(item => ['created', 'sent', 'working'].includes(item.status))
    .map(item => item.toMemberId)
  const failed = items
    .filter(item => item.status === 'failed')
    .map(item => item.toMemberId)
  const first = items[0]
  return {
    stage: stageIndex,
    workers,
    pending,
    failed,
    base: first?.context?.base ?? null,
    startedAt: Math.min(...items.map(item => item.createdAt)),
    stalled: items.some(item => item.flags?.stalled === true),
    timedOut: items.some(item => item.flags?.timedOut === true),
    integrated: items.every(item => item.flags?.integrated === true),
  }
}

export const dispatchOf = (store, roomId, stageIndex) => (
  dispatchFrom(store.readAssignments(roomId, { stage: stageIndex, limit: 500 }), stageIndex)
)

const taskStatusOf = assignment => {
  if (assignment.status === 'failed' || assignment.status === 'cancelled') return 'failed'
  if (assignment.status === 'reported' || assignment.status === 'passed' || assignment.status === 'rejected') return 'reported'
  return 'working'
}

export const tasksFrom = (assignments, stageIndex, memberNameOf = id => id) => {
  const latestByMember = new Map()
  for (const assignment of (assignments ?? []).filter(item => item.stageIndex === stageIndex && isWorkAssignment(item))) {
    latestByMember.set(assignment.toMemberId, assignment)
  }
  return [...latestByMember.values()].map(assignment => ({
    id: assignment.id,
    assignmentId: assignment.id,
    title: memberNameOf(assignment.toMemberId),
    owner: assignment.toMemberId,
    status: taskStatusOf(assignment),
    evidenceRef: assignment.evidenceIds?.[0] ?? null,
  }))
}
