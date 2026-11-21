import { randomUUID } from 'node:crypto'
import { ROUND_FIELDS } from '../../../shared/work-round.js'

export const newRoundId = () => `round-${randomUUID().slice(0, 8)}`

// 列表只带回答问题需要的字段；完整轮次只在当前视图或只读详情里给。
export const roundSummaryOf = round => ({
  id: round.id,
  roomId: round.roomId,
  projectId: round.projectId ?? null,
  ordinal: round.ordinal,
  status: round.status,
  name: round.name,
  goal: round.goal,
  startedAt: round.startedAt ?? null,
  completedAt: round.completedAt ?? null,
  completedCommit: round.completedCommit ?? null,
  usage: round.usage ?? null,
})

const roundFieldsOf = room => Object.fromEntries(
  ROUND_FIELDS
    .filter(field => room[field] !== undefined)
    .map(field => [field, room[field]]),
)

export const buildRoundFromRoom = ({
  room,
  id = newRoundId(),
  projectId = null,
  ordinal = 1,
  status = 'active',
}) => ({
  id,
  roomId: room.id,
  projectId,
  ordinal,
  status,
  name: room.name,
  ...roundFieldsOf(room),
  origin: {
    sourceRoomId: room.sourceRoomId ?? null,
    sourceName: room.sourceName ?? null,
  },
  previousRoundId: room.lastRoundId ?? null,
  startedAt: Date.now(),
})

export const buildRound = ({
  room,
  goal,
  name,
  projectId = null,
  ordinal = 1,
  status = 'active',
  plan = null,
  stages,
  gate = null,
  verificationMode = 'hybrid',
  shadowReview = false,
  orchestration = null,
  constraints = [],
  decisions = [],
  budgetMicroUsd = null,
  origin = null,
}) => ({
  id: newRoundId(),
  roomId: room.id,
  projectId,
  ordinal,
  status,
  name: name || goal,
  goal,
  plan,
  stages,
  gate,
  verificationMode,
  shadowReview,
  orchestration,
  constraints,
  decisions,
  usage: undefined,
  budgetMicroUsd: Number.isFinite(budgetMicroUsd) && budgetMicroUsd > 0 ? budgetMicroUsd : null,
  openQuestion: null,
  lastPlannerDecision: null,
  autoCheck: null,
  blocked: null,
  mergeConflict: null,
  stageBases: {},
  startHead: room.workspaceHead ?? room.startHead ?? null,
  workspaceHead: null,
  completedAt: null,
  completedCommit: null,
  completion: null,
  origin: origin ?? { sourceRoomId: room.sourceRoomId ?? null, sourceName: room.sourceName ?? null },
  previousRoundId: room.lastRoundId ?? null,
  startedAt: Date.now(),
})

export const studioFromRoom = (room, round) => {
  const studio = {
    ...room,
    state: 'active',
    activeRoundId: round.id,
    lastRoundId: room.lastRoundId ?? null,
    defaultProjectId: round.projectId ?? room.defaultProjectId ?? null,
    idle: false,
  }
  for (const field of ROUND_FIELDS) delete studio[field]
  delete studio.workRound
  delete studio.workRoundId
  return studio
}

export const composeRoundView = (studio, round) => {
  const view = { ...studio }
  for (const field of ROUND_FIELDS) {
    if (round[field] !== undefined) view[field] = round[field]
  }
  view.workRound = round
  view.workRoundId = round.id
  return view
}
