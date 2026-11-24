import { DEFAULT_STUDIO_ROSTER } from '../../../../shared/studio-roster.js'
import { normalizeMembers } from '../member-options.js'

export const DEFAULT_STUDIO_MEMBERS = normalizeMembers(DEFAULT_STUDIO_ROSTER)

export const buildStudioRequest = ({
  name,
  repoPath,
  handoffBrief,
  handoffBriefReviewed = false,
  sourceRoomId,
  sourceName,
}) => ({
  name,
  roomType: 'studio',
  repoPath,
  ...(handoffBrief === null || handoffBrief === undefined ? {} : { handoffBrief }),
  ...(handoffBriefReviewed ? { handoffBriefReviewed: true } : {}),
  ...(typeof sourceRoomId === 'string' && sourceRoomId !== '' ? { sourceRoomId } : {}),
  ...(typeof sourceName === 'string' && sourceName !== '' ? { sourceName } : {}),
})
