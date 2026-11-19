import { join } from 'node:path'
import { briefOf } from './brief.js'
import { presentRoom } from './presentation.js'
import { recommendRoster as recommendRosterUseCase } from './roster-recommend.js'
import { classifyIntent as classifyIntentUseCase } from './intent.js'
import { createRosterProbe } from './roster-probe.js'
import { listRoomTypes } from './room-types/index.js'
import { roomPresentationOfRoom } from './rooms/kinds.js'
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
  const { readRoom, readRooms, readRecentMessages, readMessagesSince, readAssignments } = store

  const publicMessage = message => {
    if (message.meta === undefined) return message
    const { baseId, turnId, sendId, echo, ...meta } = message.meta
    return { ...message, meta }
  }

  const routineRunOf = room => {
    const runId = room?.routine?.lastRoomId
    if (typeof runId !== 'string') return null
    const runRoom = readRoom(runId)
    if (runRoom === null) return null
    return { room: runRoom, messages: readRecentMessages(runRoom.id) }
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
        const children = (room.childRoomIds ?? [])
          .map(childId => readRoom(childId))
          .filter(child => child !== null)
          .map(child => ({ room: child, messages: readRecentMessages(child.id) }))
        return {
          ...presentRoom(room, messages, assignments, {
            children,
            routineRun: routineRunOf(room),
          }),
          brief: briefOf(room),
          messages,
        }
      }),
      engines,
    }
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

  const classifyIntent = body => classifyIntentUseCase({
    probe: createRosterProbe({ engine }),
    body,
    workspace,
  })

  return { health, state, messagesSince, evidence, recommendRoster, classifyIntent }
}
