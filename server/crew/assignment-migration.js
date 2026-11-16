// 旧房间把交接拆进消息、stageDispatch 和 stage.tasks；启动时一次性压成 Assignment。
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
        toRoomId: null,
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
          toRoomId: null,
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
          toRoomId: null,
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
