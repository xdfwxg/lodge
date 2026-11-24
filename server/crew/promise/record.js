import { createHash } from 'node:crypto'
import { promiseOf } from './contract.js'

const artifactPathsOf = messages => [...new Set(messages.flatMap(message => (
  (message.meta?.artifacts ?? []).map(artifact => artifact?.path).filter(Boolean)
)))]

const fingerprintOf = ({ messages, roundId, readArtifact }) => {
  const conclusion = [...messages].reverse().find(message => (
    message.kind === 'conclusion' &&
    (roundId === null || message.meta?.roundId === undefined || message.meta.roundId === roundId)
  ))
  const parts = [conclusion?.text ?? '']
  for (const path of artifactPathsOf(messages)) {
    parts.push(path, typeof readArtifact === 'function' ? String(readArtifact(path) ?? '') : '')
  }
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16)
}

// 一期交付只记一次指纹：这一期和上一期比，是第一次、有变化，还是没变化。
export const recordPromiseDelivery = ({ store, room, messages = [], readArtifact = null, now = Date.now() }) => {
  const promise = promiseOf(room)
  if (promise === null) return null
  const roundId = room.workRound?.id ?? room.lastRoundId ?? null
  if (roundId !== null && promise.lastIssueRoundId === roundId) return room
  const hash = fingerprintOf({ messages, roundId, readArtifact })
  const change = promise.lastDeliveryHash === undefined
    ? 'first'
    : promise.lastDeliveryHash === hash ? 'no' : 'yes'
  return store.updateRoom(room.id, current => {
    if (current.promise?.version !== promise.version) return null
    current.promise = {
      ...current.promise,
      lastDeliveryHash: hash,
      lastChange: change,
      lastIssueAt: now,
      lastIssueRoundId: roundId,
      version: promise.version + 1,
    }
    return { events: [{ type: 'promise.delivered', payload: { roundId, change } }] }
  })
}
