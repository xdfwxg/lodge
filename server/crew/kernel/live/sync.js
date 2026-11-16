import { memberForRef, memberNameOf } from './projection.js'
import { roomLifecycleOfRoom } from '../../rooms/kinds.js'

const memberFailureOf = message => {
  if (message?.kind !== 'activity' || message.ok !== false) return null
  const text = String(message.text ?? '')
  return /^error:\s/i.test(text) ? text : null
}

const memberFailureKind = text => {
  const lower = text.toLowerCase()
  if (lower.includes('余额') || lower.includes('insufficient') || lower.includes('quota') || lower.includes('credit')) return 'quota'
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('invalid api key')) return 'auth'
  if (lower.includes('429') || lower.includes('rate_limit') || lower.includes('rate limit')) return 'rate_limit'
  return 'engine'
}

const failureCopy = (kind, name) => ({
  quota: `${name}的模型额度不够，房间已暂停。充值或给这位成员换个模型后，点“继续”。`,
  auth: `${name}的登录失效了，房间已暂停。重新登录或换个模型服务后，点“继续”。`,
  rate_limit: `${name}被模型服务限流了，房间已暂停。稍后点“继续”，或给这位成员换个模型。`,
  engine: `${name}没能回应，房间已暂停。检查模型服务设置后，点“继续”。`,
}[kind])

// 引擎级错误（余额、鉴权、限流）不是普通命令失败；房间要停下来等人处理。
export const pauseForMemberFailure = (store, entry, message) => {
  const text = memberFailureOf(message)
  if (text === null) return
  const room = store.readRoom(entry.roomId)
  if (room === null) return
  const memberId = memberForRef(room, message.authorRef) ?? 'executor'
  const kind = memberFailureKind(text)
  const updated = store.updateRoom(entry.roomId, current => {
    if (current.state !== 'active') return null
    current.state = 'paused'
    current.pauseReason = 'member_error'
    current.idle = false
    current.memberError = { memberId, kind, at: Date.now(), detail: text.slice(0, 500) }
    return { events: [{ type: 'room.member_error', payload: { memberId, kind, detail: text.slice(0, 500) } }] }
  })
  if (updated !== null) {
    roomLifecycleOfRoom(updated)?.markMemberFailure?.(store, updated, memberId)
    store.appendMessage(entry.roomId, {
      kind: 'system',
      text: failureCopy(kind, memberNameOf(room, memberId)),
    })
  }
}

export const createMemberSync = ({ store, engine, projector }) => {
  const syncMember = async (entry, memberId) => {
    if (entry.syncing.has(memberId)) return
    const target = entry.members.get(memberId)
    if (target === undefined) return
    entry.syncing.add(memberId)
    try {
      const { messages } = await engine.history(target.sessionRef)
      for (const message of messages) {
        entry.turns.trackTool(message)
        if (message.kind === 'turn') {
          entry.turns.captureTurn(message.turn, message.authorRef)
        } else {
          const stored = projector.toStored(entry.roomId, message)
          if (stored !== null) store.upsertMessage(stored)
          pauseForMemberFailure(store, entry, message)
        }
      }
    } finally {
      entry.syncing.delete(memberId)
    }
  }

  const subscribeMember = (entry, memberId, { answerPermission, refresh }) => {
    const target = entry.members.get(memberId)
    if (target === undefined) return
    target.unsubscribe = engine.subscribe({
      roomId: target.roomRef,
      sessionRef: target.sessionRef,
      onState: state => {
        if (state.connected) void syncMember(entry, memberId)
      },
      onEvent: event => {
        if (event.type === 'room') {
          refresh(entry, { force: true })
          return
        }
        const message = event.message
        if (message?.card?.requestType === 'permission') {
          void answerPermission(entry, memberId, message)
          return
        }
        entry.turns.trackTool(message)
        if (message.kind === 'turn') {
          entry.turns.captureTurn(message.turn, message.authorRef)
          refresh(entry, { force: true })
        } else {
          const stored = projector.toStored(entry.roomId, message)
          if (stored !== null) store.upsertMessage(stored)
          pauseForMemberFailure(store, entry, message)
          refresh(entry)
        }
      },
    })
  }

  return { syncMember, subscribeMember }
}
