// 只读重放：从 room_event 重建一轮的阶段和交接状态，用来和当前状态对账。
// 事件不是写路径的真相；这里不改任何状态，发现差异只报告。
import { ASSIGNMENT_STATUS, ROUND_STATUS, STAGE_STATE } from '../../../shared/states.js'

const TERMINAL_ROUND_EVENTS = Object.freeze({
  'round.completed': ROUND_STATUS.completed,
  'round.rejected': ROUND_STATUS.rejected,
  'round.failed': ROUND_STATUS.failed,
  'round.stopped': ROUND_STATUS.stopped,
  'round.superseded': ROUND_STATUS.superseded,
})

const stageOf = (stages, index) => (
  Number.isInteger(index) && index >= 0 && index < stages.length ? stages[index] : null
)

const assignmentOf = (payload, status) => ({
  id: payload.assignmentId,
  stage: payload.stage ?? 0,
  memberId: payload.memberId ?? payload.to ?? null,
  status,
  reason: payload.reason ?? null,
})

export const replayRound = (events = [], roundId = '') => {
  const list = Array.isArray(events) ? events : []
  const startAt = list.findIndex(event => (
    event?.type === 'round.started' &&
    (roundId === '' || event.payload?.roundId === roundId)
  ))
  if (startAt < 0) {
    return {
      roundId,
      roundStatus: null,
      stages: [],
      assignments: [],
      warnings: ['没有找到这一轮的 round.started 事件'],
    }
  }
  const started = list[startAt]
  const resolvedId = started.payload?.roundId ?? roundId
  const warnings = []
  const snapshot = Array.isArray(started.payload?.stages) ? started.payload.stages : []
  if (snapshot.length === 0) warnings.push('round.started 没有阶段快照，只能重放交接')
  const stages = snapshot.map((stage, index) => ({
    index,
    title: stage.title ?? `第 ${index + 1} 步`,
    kind: stage.kind ?? '',
    state: STAGE_STATE.pending,
    assignments: [],
  }))
  let roundStatus = ROUND_STATUS.active
  const assignmentById = new Map()

  for (let at = startAt + 1; at < list.length; at += 1) {
    const event = list[at]
    // 下一轮开始，这一轮的事件窗口结束。
    if (event?.type === 'round.started') break
    const payload = event?.payload ?? {}
    const terminal = TERMINAL_ROUND_EVENTS[event?.type]
    if (terminal !== undefined) {
      roundStatus = terminal
      continue
    }
    if (event?.type === 'stage.dispatch' || event?.type === 'stage.rework') {
      const stage = stageOf(stages, payload.stage)
      if (stage !== null) stage.state = STAGE_STATE.active
      continue
    }
    if (event?.type === 'stage.passed') {
      const stage = stageOf(stages, payload.stage)
      if (stage !== null) stage.state = STAGE_STATE.passed
      continue
    }
    if (event?.type === 'stage.rewind') {
      const index = payload.stage
      if (Number.isInteger(index)) {
        for (let i = index; i < stages.length; i += 1) {
          stages[i].state = i === index ? STAGE_STATE.active : STAGE_STATE.pending
        }
      }
      continue
    }
    if (event?.type === 'assignment.created') {
      const item = assignmentOf(payload, ASSIGNMENT_STATUS.created)
      if (typeof item.id !== 'string' || item.id === '') continue
      assignmentById.set(item.id, item)
      const stage = stageOf(stages, item.stage)
      if (stage !== null) stage.assignments.push(item.id)
      continue
    }
    if (typeof event?.type === 'string' && event.type.startsWith('assignment.')) {
      const status = event.type.slice('assignment.'.length)
      const id = payload.assignmentId
      if (typeof id !== 'string' || id === '') continue
      const existing = assignmentById.get(id)
      if (existing !== undefined) {
        existing.status = status
        if (existing.memberId === null && payload.memberId !== undefined) existing.memberId = payload.memberId
        continue
      }
      const item = assignmentOf(payload, status)
      assignmentById.set(item.id, item)
      const stage = stageOf(stages, item.stage)
      if (stage !== null) stage.assignments.push(item.id)
    }
  }

  return {
    roundId: resolvedId,
    roundStatus,
    stages,
    assignments: [...assignmentById.values()],
    warnings,
  }
}

export const diffReplay = (replay, { round = null, assignments = [] } = {}) => {
  const diffs = []
  if (round !== null && replay.roundStatus !== null && round.status !== replay.roundStatus) {
    diffs.push({ kind: 'round-status', replay: replay.roundStatus, current: round.status })
  }
  for (const stage of replay.stages) {
    const current = Array.isArray(round?.stages) ? round.stages[stage.index] : undefined
    if (current === undefined) {
      diffs.push({ kind: 'stage-missing', stage: stage.index, title: stage.title })
    } else if (current.state !== stage.state) {
      diffs.push({ kind: 'stage-state', stage: stage.index, replay: stage.state, current: current.state })
    }
  }
  const currentById = new Map(assignments.map(item => [item.id, item]))
  for (const item of replay.assignments) {
    const current = currentById.get(item.id)
    if (current === undefined) {
      diffs.push({ kind: 'assignment-missing', id: item.id, replay: item.status })
      continue
    }
    if (current.status !== item.status) {
      diffs.push({ kind: 'assignment-status', id: item.id, replay: item.status, current: current.status })
    }
    currentById.delete(item.id)
  }
  for (const [id, current] of currentById) {
    diffs.push({ kind: 'assignment-not-in-events', id, current: current.status })
  }
  return diffs
}
