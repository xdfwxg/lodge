import { join } from 'node:path'
import { briefOf } from './brief.js'
import { presentRoom } from './presentation.js'
import { recommendRoster as recommendRosterUseCase } from './roster-recommend.js'
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
  const { readRoom, readRooms, readMessages, readMessagesSince, readEvidence } = store

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
        const ordered = readMessages(room.id)
          .slice()
          .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || (a.seq ?? 0) - (b.seq ?? 0))
        const messages = presentation.filterMessages(ordered).map(message => (
          typeof message.text === 'string' ? { ...message, text: toDisplayText(room, message.text) } : message
        ))
        return {
          ...presentRoom(room, messages),
          brief: briefOf(room),
          messages,
        }
      }),
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

  const recommendRoster = body => recommendRosterUseCase({ engine, body, workspace })

  return { health, state, messagesSince, evidence, recommendRoster }
}
