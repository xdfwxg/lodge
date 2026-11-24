import { DEFAULT_STUDIO_ROSTER } from '../../../../shared/studio-roster.js'
import { normalizeMembers } from '../member-options.js'

export const DEFAULT_STUDIO_MEMBERS = normalizeMembers(DEFAULT_STUDIO_ROSTER)

export const buildStudioRequest = ({
  name,
  repoPath,
  handoff,
  handoffReviewed = false,
  sourceRoomId,
  sourceName,
}) => ({
  name,
  roomType: 'studio',
  repoPath,
  ...(handoff === null || handoff === undefined ? {} : { handoff }),
  ...(handoffReviewed ? { handoffReviewed: true } : {}),
  ...(typeof sourceRoomId === 'string' && sourceRoomId !== '' ? { sourceRoomId } : {}),
  ...(typeof sourceName === 'string' && sourceName !== '' ? { sourceName } : {}),
})
