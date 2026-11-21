import { randomUUID } from 'node:crypto'
import { ROUND_FIELDS } from '../../../shared/work-round.js'

export const newRoundId = () => `round-${randomUUID().slice(0, 8)}`

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
    continuation: room.continuation ?? null,
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
  closure = 'open',
  verificationMode = 'hybrid',
  shadowReview = false,
  orchestration = null,
  constraints = [],
  decisions = [],
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
  closure,
  verificationMode,
  shadowReview,
  orchestration,
  constraints,
  decisions,
  usage: undefined,
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
  origin: origin ?? { sourceRoomId: room.sourceRoomId ?? null, sourceName: room.sourceName ?? null, continuation: null },
  previousRoundId: room.lastRoundId ?? null,
  startedAt: Date.now(),
})

export const studioFromRoom = (room, round) => {
  const studio = {
    ...room,
    state: 'active',
    activeRoundId: round.id,
    lastRoundId: room.lastRoundId ?? null,
    idle: false,
  }
  for (const field of ROUND_FIELDS) delete studio[field]
  delete studio.pastGoals
  delete studio.nextRoomId
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
