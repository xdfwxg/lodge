import * as log from './log.js'
import { randomUUID } from 'node:crypto'
import { ASSIGNMENT_STATUS, ASSIGNMENT_STATUSES, ASSIGNMENT_TERMINAL, ASSIGNMENT_TRANSITIONS } from '../../shared/states.js'

// Assignment 是房间内的一次交接：谁把什么交给谁，交付证据是什么。
// Member 是长期身份；Assignment 只引用 memberId 或子房 id，不复制成员属性。
const WORK_REASONS = Object.freeze(['dispatch', 'rework', 'retry'])

const canTransition = (from, to) => (
  from === to || (ASSIGNMENT_TRANSITIONS[from] ?? []).includes(to)
)

export const isWorkAssignment = assignment => WORK_REASONS.includes(assignment?.reason)

const now = () => Date.now()

const assertTarget = ({ store, roomId, toMemberId, toRoomId }) => {
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
  status = ASSIGNMENT_STATUS.created,
  evidenceIds = [],
  id = null,
  attempt = null,
}) => {
  // 同一个 id 永远对应同一次交接：存在就返回原记录，不覆盖证据和结果。
  if (id !== null) {
    const existing = store.readAssignment(id)
    if (existing !== null) {
      if (existing.roomId !== roomId) throw new Error('交接 id 属于另一个房间')
      return existing
    }
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

export const assignmentForTurn = (store, roomId, stageIndex, memberId, turnId, startedAt = null) => {
  const list = activeDispatchAssignments(store, roomId, stageIndex)
    .filter(item => item.toMemberId === memberId)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const matched = list.find(item => turnId !== undefined && item.turnId === turnId)
  if (matched !== undefined) return matched
  // 迟到回合按“开始时哪次交接在场”归因；拿不到开始时间才退回唯一一条未收口交接。
  if (Number.isFinite(startedAt)) {
    const active = list
      .filter(item => Number.isFinite(item.sentAt) && item.sentAt <= startedAt)
      .filter(item => !Number.isFinite(item.finishedAt) || startedAt <= item.finishedAt)
      .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))
    if (active.length > 0) return active[0]
  }
  const open = list.filter(item => (
    [ASSIGNMENT_STATUS.sent, ASSIGNMENT_STATUS.working].includes(item.status) &&
    (item.turnId === undefined || item.turnId === null)
  ))
  return open.length === 1 ? open[0] : null
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
  if (patch.status === ASSIGNMENT_STATUS.sent && assignment.sentAt === null) assignment.sentAt = now()
  if (patch.status === ASSIGNMENT_STATUS.reported || ASSIGNMENT_TERMINAL.has(patch.status)) assignment.lease = null
  if (ASSIGNMENT_TERMINAL.has(patch.status) && assignment.finishedAt === null) assignment.finishedAt = now()
  return true
})

// 状态只从这里改：校验和写入在同一个事务里，非法跃迁返回 null。
// 状态落库后补一条审计事件；事件写失败不回滚业务状态。
export const transitionAssignment = (store, id, status, patch = {}) => {
  if (!ASSIGNMENT_STATUSES.has(status)) return null
  const from = typeof store.readAssignment === 'function' ? (store.readAssignment(id)?.status ?? null) : null
  const updated = store.updateAssignment(id, assignment => {
    if (!canTransition(assignment.status, status)) return false
    Object.assign(assignment, patch, { status })
    if (status === ASSIGNMENT_STATUS.sent && assignment.sentAt === null) assignment.sentAt = now()
    if (status === ASSIGNMENT_STATUS.reported || ASSIGNMENT_TERMINAL.has(status)) assignment.lease = null
    if (ASSIGNMENT_TERMINAL.has(status) && assignment.finishedAt === null) assignment.finishedAt = now()
    return true
  })
  if (updated !== null && typeof store.appendEvent === 'function') {
    try {
      store.appendEvent(updated.roomId, `assignment.${status}`, {
        assignmentId: id,
        roundId: updated.workRoundId ?? null,
        stage: updated.stageIndex ?? 0,
        from,
        to: status,
        ...(updated.toMemberId === undefined ? {} : { memberId: updated.toMemberId }),
        ...(updated.reason === undefined ? {} : { reason: updated.reason }),
        ...(updated.turnId === undefined ? {} : { turnId: updated.turnId }),
        ...(updated.messageId === undefined ? {} : { messageId: updated.messageId }),
      })
    } catch (error) {
      log.warn(`[lodge] assignment event failed: ${error?.message ?? error}`)
    }
  }
  return updated
}

// 用户停下回复时，未终态的交接一起取消；否则下一步会一直等一个不会回来的结果。
export const cancelOpenAssignments = (store, roomId, { reason = '' } = {}) => {
  let cancelled = 0
  for (const assignment of store.readAssignments(roomId, { limit: 5000 })) {
    if (ASSIGNMENT_TERMINAL.has(assignment.status)) continue
    if (transitionAssignment(store, assignment.id, ASSIGNMENT_STATUS.cancelled, { resultText: reason }) !== null) {
      cancelled += 1
    }
  }
  return cancelled
}
