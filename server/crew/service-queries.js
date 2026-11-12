import { join } from 'node:path'
import { budgetSummary, globalBudgetStatus } from './budget.js'
import { presentRoom } from './presentation.js'
import { buildResources } from './resources.js'
import { buildReview } from './review.js'
import { recommendRoster as recommendRosterUseCase } from './roster-recommend.js'
import { listRoomTypes } from './room-types/index.js'
import { TEMPLATE_LIST } from './seats.js'
import { fail, ok } from './result.js'

export const createServiceQueries = ({
  store,
  engine,
  seats,
  dataDir,
  dispatchPayload,
  roomFiles,
  templates,
  project,
  usage: usagePort,
  deliveries,
  files,
  workspace,
}) => {
  const { readRoom, readRooms, readMessages, readMessagesSince } = store

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
      templates: TEMPLATE_LIST,
      roomTypes: listRoomTypes(),
      savedTemplates: typeof dataDir === 'string' ? templates.list(dataDir) : [],
      rooms: rooms.map(room => {
        const messages = readMessages(room.id)
        return { ...presentRoom(room, messages), brief: roomFiles.readBrief(room), messages }
      }),
      dispatch: dispatchPayload(),
      budget: budgetSummary(rooms),
      engines,
      importedDeliveries: typeof dataDir === 'string' ? deliveries.read(dataDir) : [],
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

  const recommendRoster = body => {
    const global = globalBudgetStatus(readRooms())
    if (!global.ok) return fail('conflict', global.message)
    return recommendRosterUseCase({ engine, body, workspace })
  }

  return { health, state, messagesSince, evidence, resources, usage, projectConstraints, review, recommendRoster }
}
