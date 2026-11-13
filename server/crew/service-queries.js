import { join } from 'node:path'
import { budgetSummary, globalBudgetStatus } from './budget.js'
import { presentRoom } from './presentation.js'
import { buildResources } from './resources.js'
import { buildReview } from './review.js'
import { recommendRoster as recommendRosterUseCase } from './roster-recommend.js'
import { listRoomTypes } from './room-types/index.js'
import { toDisplayText } from './seat-labels.js'
import { fail, ok } from './result.js'
import { replayTransitions } from './room-state.js'
import { buildShadowComparison } from './shadow-review.js'
import { verifyEvidenceIntegrity } from './evidence-ledger.js'

export const createServiceQueries = ({
  store,
  engine,
  seats,
  dispatchPayload,
  roomFiles,
  project,
  usage: usagePort,
  files,
  workspace,
}) => {
  const { readRoom, readRooms, readMessages, readMessagesSince, readEvents, readEvidence } = store

  const health = async () => ok({ runtime: await engine.health() })

  const state = async () => {
    const rooms = readRooms()
    let engines = []
    try {
      engines = await engine.instances()
    } catch {
      engines = []
    }
    return {
      seats,
      roomTypes: listRoomTypes(),
      rooms: rooms.map(room => {
        const messages = readMessages(room.id)
          .slice()
          .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || (a.seq ?? 0) - (b.seq ?? 0))
          .map(message => (
            typeof message.text === 'string' ? { ...message, text: toDisplayText(room, message.text) } : message
          ))
        return { ...presentRoom(room, messages), brief: roomFiles.readBrief(room), messages }
      }),
      dispatch: dispatchPayload(),
      budget: budgetSummary(rooms),
      engines,
    }
  }

  const messagesSince = since => readMessagesSince(since)

  const evidence = (roomId, messageId) => {
    const room = readRoom(roomId)
    if (room === null) return fail('not_found', '没有这个房间')
    const file = join(roomFiles.roomDir(room), 'evidence', `${messageId}.json`)
    if (!files.exists(file)) return fail('not_found', '没有这份证据')
    return { ok: true, bytes: files.read(file) }
  }

  const resources = () => ok({ resources: buildResources(readRooms(), readMessages) })

  const usage = range => ok({
    usage: usagePort.aggregate({ rooms: readRooms(), historyOf: usagePort.read, range }),
  })

  const projectConstraints = repoPath => {
    const source = typeof repoPath === 'string' ? repoPath.trim() : ''
    if (source === '') return fail('invalid', '先填工作目录')
    const file = project.read(source)
    return ok({
      path: file?.path ?? null,
      content: file?.content ?? null,
      layers: file?.layers ?? [],
    })
  }

  const review = roomId => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    return ok({ review: buildReview(room, readMessages(roomId)) })
  }

  // 只读回放：按审计事件逐步校验转移是否合法，不修改房间。
  const transitions = roomId => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    const events = readEvents(roomId, 500)
      .filter(item => item.type === 'closure.transition' || item.type === 'chat.transition')
      .sort((a, b) => a.seq - b.seq)
    const currentState = room.roomType === 'chat'
      ? room.chat?.phase ?? 'discussing'
      : room.closure ?? 'open'
    return ok({
      transitions: {
        roomId,
        roomType: room.roomType,
        ...replayTransitions({ roomType: room.roomType, events, currentState }),
      },
    })
  }

  const evidenceLedger = roomId => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    return ok({
      ledger: readEvidence(roomId).map(item => ({
        id: item.id,
        seq: item.seq,
        digest: item.digest,
        authorId: item.authorId,
        kind: item.meta?.kind ?? '',
        stage: item.meta?.stage ?? 0,
        command: item.meta?.command ?? '',
        exit: item.meta?.exit ?? null,
        at: item.at,
        text: typeof item.text === 'string' ? item.text.slice(0, 200) : '',
      })),
    })
  }

  const evidenceIntegrity = roomId => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    return ok({
      integrity: {
        roomId,
        ...verifyEvidenceIntegrity(readEvidence(roomId)),
      },
    })
  }

  const shadowReview = roomId => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    if (room.roomType !== 'studio') return fail('invalid', '只有工作室有评审对照')
    return ok({
      shadowReview: buildShadowComparison({
        evidence: readEvidence(roomId),
        messages: readMessages(roomId),
      }),
    })
  }

  const recommendRoster = body => {
    const global = globalBudgetStatus(readRooms())
    if (!global.ok) return fail('conflict', global.message)
    return recommendRosterUseCase({ engine, body, workspace })
  }

  return { health, state, transitions, evidenceLedger, evidenceIntegrity, shadowReview, messagesSince, evidence, resources, usage, projectConstraints, review, recommendRoster }
}
