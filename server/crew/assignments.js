import { randomUUID } from 'node:crypto'

// Assignment 是房间内的一次交接：谁把什么交给谁，交付证据是什么。
// Member 是长期身份；Assignment 只引用 memberId，不复制成员属性。
export const ASSIGNMENT_REASONS = Object.freeze(['dispatch', 'review', 'rework', 'retry', 'subroom'])
export const ASSIGNMENT_STATUSES = Object.freeze([
  'created', 'sent', 'working', 'reported', 'reviewing', 'passed', 'rejected', 'failed', 'cancelled',
])
export const ASSIGNMENT_TERMINAL = Object.freeze(['passed', 'rejected', 'failed', 'cancelled'])

// 交接只有一条状态链：创建 → 送达 → 交付 → 收口。终态不再被改回去。
export const ASSIGNMENT_TRANSITIONS = Object.freeze({
  created: ['sent', 'failed', 'cancelled'],
  sent: ['working', 'reported', 'passed', 'rejected', 'failed', 'cancelled'],
  working: ['reported', 'passed', 'rejected', 'failed', 'cancelled'],
  reported: ['reviewing', 'passed', 'rejected', 'failed'],
  reviewing: ['passed', 'rejected', 'failed', 'cancelled'],
  passed: [],
  rejected: ['failed'],
  failed: [],
  cancelled: [],
})

export const canTransition = (from, to) => (
  from === to || (ASSIGNMENT_TRANSITIONS[from] ?? []).includes(to)
)

const now = () => Date.now()

export const createAssignment = ({
  store,
  roomId,
  stageIndex,
  fromMemberId,
  toMemberId,
  reason = 'dispatch',
  brief = {},
  parentAssignmentId = null,
  context = {},
  status = 'created',
  evidenceIds = [],
  id = null,
}) => {
  // 同一个 id 永远对应同一次交接：存在就返回原记录，不覆盖证据和结果。
  if (id !== null) {
    const existing = store.readAssignment(id)
    if (existing !== null) return existing
  }
  const at = now()
  return store.writeAssignment({
    id: id ?? `as-${randomUUID()}`,
    roomId,
    stageIndex,
    fromMemberId: fromMemberId ?? null,
    toMemberId,
    reason,
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
    flags: {},
    createdAt: at,
    sentAt: null,
    finishedAt: null,
    updatedAt: at,
  })
}

export const assignmentsForStage = (store, roomId, stageIndex, { limit = 500 } = {}) => (
  store.readAssignments(roomId, { stage: stageIndex, limit })
)

export const openAssignmentsForStage = (store, roomId, stageIndex) => (
  assignmentsForStage(store, roomId, stageIndex)
    .filter(item => ['created', 'sent', 'working', 'reported', 'reviewing'].includes(item.status))
)

export const activeDispatchAssignments = (store, roomId, stageIndex) => (
  assignmentsForStage(store, roomId, stageIndex)
    .filter(item => ['dispatch', 'rework', 'retry'].includes(item.reason))
)

// 旧的 stageDispatch 视图：从 Assignment 现算，不再写回房间。
export const dispatchFrom = (assignments, stageIndex) => {
  const list = (assignments ?? []).filter(item => item.stageIndex === stageIndex && ['dispatch', 'rework', 'retry'].includes(item.reason))
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

// 旧的 stage.tasks 视图：从 Assignment 现算，不再写回房间。
export const tasksFrom = (assignments, stageIndex, memberNameOf = id => id) => {
  const latestByMember = new Map()
  for (const assignment of (assignments ?? []).filter(item => item.stageIndex === stageIndex && ['dispatch', 'rework', 'retry'].includes(item.reason))) {
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

export const tasksOf = (store, roomId, stageIndex, memberNameOf = id => id) => (
  tasksFrom(store.readAssignments(roomId, { stage: stageIndex, limit: 500 }), stageIndex, memberNameOf)
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

export const reviewAssignmentsForStage = (store, roomId, stageIndex) => (
  assignmentsForStage(store, roomId, stageIndex)
    .filter(item => item.reason === 'review')
)

export const updateAssignment = (store, id, patch) => store.updateAssignment(id, assignment => {
  Object.assign(assignment, patch)
  if (patch.status === 'sent' && assignment.sentAt === null) assignment.sentAt = now()
  if (ASSIGNMENT_TERMINAL.includes(patch.status) && assignment.finishedAt === null) {
    assignment.finishedAt = now()
  }
  return true
})

// 状态只从这里改：非法跃迁返回 null，调用方知道这次没生效。
export const transitionAssignment = (store, id, status, patch = {}) => {
  if (!ASSIGNMENT_STATUSES.includes(status)) return null
  const current = store.readAssignment?.(id) ?? null
  if (current === null || !canTransition(current.status, status)) return null
  return updateAssignment(store, id, { ...patch, status })
}

export const latestDispatchAssignment = (store, roomId, stageIndex, memberId = null) => (
  assignmentsForStage(store, roomId, stageIndex)
    .filter(item => ['dispatch', 'rework', 'retry'].includes(item.reason))
    .filter(item => memberId === null || item.toMemberId === memberId)
    .at(-1)
    ?? null
)

// 历史分页：先给最新一页，再按 before=上一页最早的 id 往前翻。
export const pageAssignments = (store, roomId, { stage = null, status = null, before = null, limit = 50 } = {}) => {
  const size = Math.max(1, Math.min(500, Number(limit) || 50))
  const rows = store.readAssignments(roomId, { stage, status, before, limit: size + 1 })
  const hasMore = rows.length > size
  const items = hasMore ? rows.slice(1) : rows
  return { items, hasMore, next: hasMore ? items[0]?.id ?? null : null }
}

export const ASSIGNMENT_KEEP = 2000

// 每个房间只保留最近的终态记录；未收口的交接和最近 keep 条不删。
export const compactAssignments = store => {
  if (typeof store.pruneAssignments !== 'function') return 0
  let removed = 0
  for (const room of store.readRooms()) removed += store.pruneAssignments(room.id, { keep: ASSIGNMENT_KEEP })
  return removed
}

const legacyStatus = status => {
  if (status === 'failed') return 'failed'
  if (status === 'sent') return 'sent'
  return 'created'
}

const taskStatus = status => {
  if (status === 'failed') return 'failed'
  if (status === 'reported' || status === 'done') return 'reported'
  return 'sent'
}

// 旧房间把交接拆进消息、stageDispatch 和 stage.tasks；启动时压成 Assignment 行。
export const migrateAssignments = store => {
  let migrated = 0
  for (const room of store.readRooms()) {
    let changed = false
    if (!Array.isArray(room.stages)) continue
    const existing = store.readAssignments(room.id, { limit: 5000 })
    const seen = new Set(existing.map(item => item.id))
    const byStageMember = new Set(existing.map(item => `${item.stageIndex}:${item.toMemberId}`))
    const add = (assignment, { oncePerMember = false } = {}) => {
      if (seen.has(assignment.id)) return false
      if (oncePerMember && byStageMember.has(`${assignment.stageIndex}:${assignment.toMemberId}`)) return false
      store.writeAssignment(assignment)
      seen.add(assignment.id)
      byStageMember.add(`${assignment.stageIndex}:${assignment.toMemberId}`)
      migrated += 1
      changed = true
      return true
    }

    for (const message of store.readMessages(room.id)) {
      if (message.kind !== 'handoff') continue
      const meta = message.meta ?? {}
      const stageIndex = Number.isInteger(meta.stage) ? meta.stage : 0
      const toMemberId = typeof meta.to === 'string'
        ? meta.to
        : Array.isArray(meta.workers) && typeof meta.workers[0] === 'string' ? meta.workers[0] : ''
      if (toMemberId === '') continue
      const workTurn = meta.workTurn ?? {}
      const id = `as-${String(meta.deliveryId ?? message.id).replace(/[^A-Za-z0-9_-]/g, '')}`
      const status = legacyStatus(meta.status)
      add({
        id,
        roomId: room.id,
        stageIndex,
        fromMemberId: typeof meta.from === 'string' ? meta.from : null,
        toMemberId,
        reason: typeof meta.reason === 'string' ? meta.reason : 'dispatch',
        brief: {
          stageTitle: workTurn.title ?? room.stages?.[stageIndex]?.title ?? '',
          kind: workTurn.kind ?? room.stages?.[stageIndex]?.kind ?? '',
          goal: workTurn.goal ?? room.goal ?? '',
          done: Array.isArray(workTurn.done) ? workTurn.done : [],
          constraints: Array.isArray(workTurn.constraints) ? workTurn.constraints : [],
          acceptance: workTurn.acceptance ?? meta.acceptance ?? '',
          prompt: '',
        },
        status,
        sendId: typeof meta.deliveryId === 'string' ? meta.deliveryId : null,
        messageId: message.id,
        turnId: null,
        evidenceIds: typeof workTurn.evidence?.id === 'string' ? [workTurn.evidence.id] : [],
        verdictIds: [],
        candidate: workTurn.candidate ?? null,
        resultText: typeof workTurn.evidence?.text === 'string' ? workTurn.evidence.text : '',
        parentAssignmentId: null,
        context: {
          ...(typeof workTurn.evidence?.id === 'string' ? { evidenceId: workTurn.evidence.id } : {}),
          ...(workTurn.candidate === null || workTurn.candidate === undefined ? {} : { candidate: workTurn.candidate }),
        },
        flags: {},
        createdAt: message.ts ?? Date.now(),
        sentAt: status === 'sent' ? message.ts ?? Date.now() : null,
        finishedAt: null,
        updatedAt: message.ts ?? Date.now(),
      })
      // 旧消息只保留 Assignment 引用；交接事实在 assignment 表里。
      store.upsertMessage({
        ...message,
        meta: { assignmentId: id, stage: stageIndex, status: meta.status === 'failed' ? 'failed' : 'sent' },
      })
    }

    if (room.stageDispatch !== undefined && room.stageDispatch !== null) {
      const dispatch = room.stageDispatch
      const stageIndex = Number.isInteger(dispatch.stage) ? dispatch.stage : 0
      const fromMemberId = room.leadMemberId ?? null
      for (const toMemberId of dispatch.workers ?? []) {
        const failed = (dispatch.failed ?? []).includes(toMemberId)
        const pending = (dispatch.pending ?? []).includes(toMemberId)
        add({
          id: `as-legacy-${room.id}-${stageIndex}-${toMemberId}`,
          roomId: room.id,
          stageIndex,
          fromMemberId,
          toMemberId,
          reason: 'dispatch',
          brief: {
            stageTitle: room.stages?.[stageIndex]?.title ?? '',
            kind: room.stages?.[stageIndex]?.kind ?? '',
            goal: room.goal ?? '',
            done: Array.isArray(room.plan?.done) ? room.plan.done : [],
            constraints: Array.isArray(room.constraints) ? room.constraints : [],
            acceptance: room.stages?.[stageIndex]?.acceptance ?? '',
            prompt: '',
          },
          status: failed ? 'failed' : pending ? 'sent' : 'reported',
          sendId: null,
          messageId: null,
          turnId: null,
          evidenceIds: [],
          verdictIds: [],
          candidate: null,
          resultText: '',
          parentAssignmentId: null,
          context: { base: dispatch.base ?? null, parallel: true },
          flags: {
            ...(dispatch.stalled === true ? { stalled: true } : {}),
            ...(dispatch.timedOut === true ? { timedOut: true } : {}),
            ...(dispatch.integrated === true ? { integrated: true } : {}),
          },
          createdAt: dispatch.startedAt ?? Date.now(),
          sentAt: dispatch.startedAt ?? Date.now(),
          finishedAt: null,
          updatedAt: Date.now(),
        })
      }
      delete room.stageDispatch
      changed = true
    }

    for (const [stageIndex, stage] of (room.stages ?? []).entries()) {
      for (const task of stage.tasks ?? []) {
        if (typeof task?.owner !== 'string' || task.owner === '') continue
        add({
          id: `as-legacy-${room.id}-${stageIndex}-${task.owner}`,
          roomId: room.id,
          stageIndex,
          fromMemberId: room.leadMemberId ?? null,
          toMemberId: task.owner,
          reason: 'dispatch',
          brief: {
            stageTitle: stage.title ?? '',
            kind: stage.kind ?? '',
            goal: room.goal ?? '',
            done: Array.isArray(room.plan?.done) ? room.plan.done : [],
            constraints: Array.isArray(room.constraints) ? room.constraints : [],
            acceptance: stage.acceptance ?? '',
            prompt: '',
          },
          status: taskStatus(task.status),
          sendId: null,
          messageId: null,
          turnId: null,
          evidenceIds: typeof task.evidenceRef === 'string' ? [task.evidenceRef] : [],
          verdictIds: [],
          candidate: null,
          resultText: '',
          parentAssignmentId: null,
          context: {},
          flags: {},
          createdAt: Date.now(),
          sentAt: Date.now(),
          finishedAt: null,
          updatedAt: Date.now(),
        }, { oncePerMember: true })
      }
      if (stage.tasks !== undefined) { delete stage.tasks; changed = true }
    }

    if (changed) store.writeRoom(room)
  }
  return migrated
}
