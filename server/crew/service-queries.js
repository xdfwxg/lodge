import { join } from 'node:path'
import { briefOf } from './brief.js'
import { presentRoom } from './presentation.js'
import { recommendRoster as recommendRosterUseCase } from './roster-recommend.js'
import { createRosterProbe } from './roster-probe.js'
import { listRoomTypes } from './rooms/kinds.js'
import { roomPresentationOfRoom } from './rooms/kinds.js'
import { composeRoundView, roundSummaryOf } from './rounds/record.js'
import { toDisplayText } from './member-labels.js'
import { fail, ok } from './result.js'

export const createServiceQueries = ({
  store,
  engine,
  roles,
  roomFiles,
  files,
  workspace,
}) => {
  const {
    readRoom,
    readRooms,
    readRecentMessages,
    readMessagesSince,
    readAssignments,
    readProjects,
    readWorkRound,
    readWorkRounds,
    readWorkRoundsByProject,
  } = store

  const publicMessage = message => {
    if (message.meta === undefined) return message
    const { baseId, turnId, turnFinal, sendId, echo, ...meta } = message.meta
    return { ...message, meta }
  }

  const health = async () => ok({ runtime: await engine.health() })

  const state = async () => {
    const rooms = readRooms()
    let engines = []
    try {
      engines = await engine.instances()
    } catch {
      engines = []
    }
    let features = { skillsLibrary: false }
    try {
      features = await engine.features()
    } catch {
      features = { skillsLibrary: false }
    }
    return {
      roles,
      features,
      roomTypes: listRoomTypes(),
      profile: typeof store.readProfile === 'function'
        ? store.readProfile()
        : { name: '', avatar: null, updatedAt: null },
      rooms: rooms.map(room => {
        const presentation = roomPresentationOfRoom(room)
        const ordered = readRecentMessages(room.id)
          .slice()
          .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || (a.seq ?? 0) - (b.seq ?? 0))
        const messages = presentation.filterMessages(ordered)
          .map(publicMessage)
          .map(message => (
            typeof message.text === 'string' ? { ...message, text: toDisplayText(room, message.text) } : message
          ))
        const assignments = readAssignments(room.id, { limit: 500 })
        return {
          ...presentRoom(room, messages, assignments),
          brief: briefOf(room),
          messages,
          rounds: readWorkRounds(room.id).map(roundSummaryOf),
        }
      }),
      projects: readProjects().map(project => ({
        ...project,
        rounds: readWorkRoundsByProject(project.id).map(roundSummaryOf),
      })),
      engines,
    }
  }

  // 旧轮是历史，只读：按轮取消息，永不混进当前轮。
  const roundDetail = (roomId, roundId) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    const round = readWorkRound(roundId, roomId)
    if (round === null) return fail('not_found', '没有这一轮')
    const ordered = readRecentMessages(room.id, 5000, { workRoundId: round.id })
      .slice()
      .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || (a.seq ?? 0) - (b.seq ?? 0))
    const messages = ordered
      .map(publicMessage)
      .map(message => (
        typeof message.text === 'string' ? { ...message, text: toDisplayText(room, message.text) } : message
      ))
    const view = composeRoundView(room, round)
    const assignments = readAssignments(room.id, { workRoundId: round.id, limit: 500 })
    return ok({
      round,
      room: presentRoom(view, messages, assignments),
      messages,
    })
  }

  const messagesSince = since => readMessagesSince(since).map(publicMessage)

  const evidence = (roomId, messageId) => {
    const room = readRoom(roomId)
    if (room === null) return fail('not_found', '没有这个房间')
    const file = join(roomFiles.roomDir(room), 'evidence', `${messageId}.json`)
    if (!files.exists(file)) return fail('not_found', '没有这份证据')
    return { ok: true, bytes: files.read(file) }
  }

  const recommendRoster = body => recommendRosterUseCase({
    probe: createRosterProbe({ engine }),
    body,
    workspace,
  })

  return { health, state, roundDetail, messagesSince, evidence, recommendRoster }
}
