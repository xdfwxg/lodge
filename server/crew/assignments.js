import { randomUUID } from 'node:crypto'

// Assignment 是房间内的一次交接：谁把什么交给谁，交付证据是什么。
// Member 是长期身份；Assignment 只引用 memberId 或子房 id，不复制成员属性。
const WORK_REASONS = Object.freeze(['dispatch', 'rework', 'retry'])
const ASSIGNMENT_STATUSES = Object.freeze([
  'created', 'sent', 'working', 'reported', 'reviewing', 'passed', 'rejected', 'failed', 'cancelled',
])
const ASSIGNMENT_TERMINAL = Object.freeze(['passed', 'rejected', 'failed', 'cancelled'])

// 交接只有一条状态链：创建 → 送达 → 交付 → 收口。终态不再被改回去。
const ASSIGNMENT_TRANSITIONS = Object.freeze({
  created: ['sent', 'failed', 'cancelled'],
  sent: ['working', 'reported', 'passed', 'rejected', 'failed', 'cancelled'],
  working: ['reported', 'passed', 'rejected', 'failed', 'cancelled'],
  reported: ['reviewing', 'passed', 'rejected', 'failed', 'cancelled'],
  reviewing: ['passed', 'rejected', 'failed', 'cancelled'],
  passed: [],
  rejected: ['failed'],
  failed: [],
  cancelled: [],
})

const canTransition = (from, to) => (
  from === to || (ASSIGNMENT_TRANSITIONS[from] ?? []).includes(to)
)

export const isWorkAssignment = assignment => WORK_REASONS.includes(assignment?.reason)

const now = () => Date.now()

const assertTarget = ({ store, roomId, reason, toMemberId, toRoomId }) => {
  if (reason === 'subroom') {
    if (typeof toRoomId !== 'string' || toRoomId === '') throw new Error('子房交接需要一个子房')
    if (toMemberId !== null && toMemberId !== undefined) throw new Error('子房交接不指向单个成员')
    return
  }
  if (typeof toMemberId !== 'string' || toMemberId === '') throw new Error('交接需要一个接收成员')
  if (typeof toRoomId === 'string' && toRoomId !== '') throw new Error('成员交接不能指向房间')
  const room = store.readRoom?.(roomId) ?? null
  const members = Array.isArray(room?.members) ? room.members : []
  if (members.length > 0 && !members.some(member => member.id === toMemberId)) {
    throw new Error(`接收成员不在房间里：${toMemberId}`)
  }
}

const nextAttempt = (store, roomId, stageIndex, toMemberId) => {
  if (typeof toMemberId !== 'string' || toMemberId === '') return 1
  const prior = assignmentsForStage(store, roomId, stageIndex)
    .filter(item => isWorkAssignment(item) && item.toMemberId === toMemberId)
  return prior.reduce((max, item) => Math.max(max, Number(item.attempt) || 0), 0) + 1
}

export const createAssignment = ({
  store,
  roomId,
  stageIndex,
  fromMemberId,
  toMemberId = null,
  toRoomId = null,
  reason = 'dispatch',
  brief = {},
  parentAssignmentId = null,
  context = {},
  status = 'created',
  evidenceIds = [],
  id = null,
  attempt = null,
}) => {
  // 同一个 id 永远对应同一次交接：存在就返回原记录，不覆盖证据和结果。
  if (id !== null) {
    const existing = store.readAssignment(id)
    if (existing !== null) return existing
  }
  assertTarget({ store, roomId, reason, toMemberId, toRoomId })
  const at = now()
  return store.writeAssignment({
    id: id ?? `as-${randomUUID()}`,
    roomId,
    stageIndex,
    fromMemberId: fromMemberId ?? null,
    toMemberId,
    toRoomId,
    reason,
    attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : nextAttempt(store, roomId, stageIndex, toMemberId),
    brief,
    status,
    sendId: null,
    messageId: null,
    turnId: null,
    evidenceIds: Array.isArray(evidenceIds) ? evidenceIds : [],
    verdictIds: [],
    candidate: null,
    resultText: '',
    parentAssignmentId,
    context,
    lease: null,
    flags: {},
    createdAt: at,
    sentAt: null,
    finishedAt: null,
    updatedAt: at,
  })
}

const assignmentsForStage = (store, roomId, stageIndex, { limit = 500 } = {}) => (
  store.readAssignments(roomId, { stage: stageIndex, limit })
)

export const activeDispatchAssignments = (store, roomId, stageIndex) => (
  assignmentsForStage(store, roomId, stageIndex).filter(isWorkAssignment)
)

export const assignmentForTurn = (store, roomId, stageIndex, memberId, turnId) => {
  const list = activeDispatchAssignments(store, roomId, stageIndex)
    .filter(item => item.toMemberId === memberId)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return list.find(item => turnId !== undefined && item.turnId === turnId)
    ?? list.find(item => ['sent', 'working', 'reported'].includes(item.status))
    ?? list[0]
    ?? null
}

export const latestDispatchAssignment = (store, roomId, stageIndex, memberId = null) => (
  assignmentsForStage(store, roomId, stageIndex)
    .filter(isWorkAssignment)
    .filter(item => memberId === null || item.toMemberId === memberId)
    .at(-1)
    ?? null
)

export const updateAssignment = (store, id, patch) => store.updateAssignment(id, assignment => {
  Object.assign(assignment, patch)
  if (patch.status === 'sent' && assignment.sentAt === null) assignment.sentAt = now()
  if (patch.status === 'reported' || ASSIGNMENT_TERMINAL.includes(patch.status)) assignment.lease = null
  if (ASSIGNMENT_TERMINAL.includes(patch.status) && assignment.finishedAt === null) assignment.finishedAt = now()
  return true
})

// 状态只从这里改：校验和写入在同一个事务里，非法跃迁返回 null。
export const transitionAssignment = (store, id, status, patch = {}) => {
  if (!ASSIGNMENT_STATUSES.includes(status)) return null
  return store.updateAssignment(id, assignment => {
    if (!canTransition(assignment.status, status)) return false
    Object.assign(assignment, patch, { status })
    if (status === 'sent' && assignment.sentAt === null) assignment.sentAt = now()
    if (status === 'reported' || ASSIGNMENT_TERMINAL.includes(status)) assignment.lease = null
    if (ASSIGNMENT_TERMINAL.includes(status) && assignment.finishedAt === null) assignment.finishedAt = now()
    return true
  })
}
