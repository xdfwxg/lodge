import * as log from '../../log.js'
import { memberForRef, memberNameOf } from './projection.js'
import { roomLifecycleOfRoom } from '../../rooms/kinds.js'
import { failureCopy, isMemberFailureText, memberFailureKind } from '../../member-failure.js'
import { PAUSE_REASON, ROOM_STATE } from '../../../../shared/states.js'

const memberFailureOf = message => {
  if (message?.kind !== 'activity' || message.ok !== false) return null
  const text = String(message.text ?? '')
  return isMemberFailureText(text) ? text : null
}

// 引擎级错误（余额、鉴权、限流）不是普通命令失败；房间要停下来等人处理。
export const pauseForMemberFailure = (store, entry, message) => {
  const text = memberFailureOf(message)
  if (text === null) return
  const room = store.readRoom(entry.roomId)
  if (room === null) return
  const memberId = memberForRef(room, message.authorRef) ?? 'executor'
  const kind = memberFailureKind(text)
  const updated = store.updateRoom(entry.roomId, current => {
    if (current.state !== ROOM_STATE.active) return null
    current.state = ROOM_STATE.paused
    current.pauseReason = PAUSE_REASON.member_error
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

// 成员私聊线程里的说话不是房间发言：同一句回答也会从群聊来一遍，投影进来就是两条一样的气泡。
// 私聊只取回合（成为证据），文字、活动和卡片仍以群聊为准。
export const createMemberSync = ({ store, engine, projector }) => {
  const syncMember = async (entry, memberId) => {
    if (entry.syncing.has(memberId)) return
    const target = entry.members.get(memberId)
    if (target === undefined) return
    entry.syncing.add(memberId)
    try {
      const { messages } = await engine.history(target.sessionRef)
      for (const message of messages) {
        // 权限卡归实时订阅和审批桥；历史里的旧卡不能再落库，否则会留下一个永远等人的问题。
        if (message.card?.requestType === 'permission') continue
        entry.turns.trackTool(message)
        if (message.kind === 'turn') {
          entry.turns.captureTurn(message.turn, message.authorRef)
        } else if (message.kind !== 'text') {
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
        if (state.connected) {
          void syncMember(entry, memberId).catch(error => {
            log.warn(`member resync failed: ${entry.roomId} ${memberId} ${error?.message ?? error}`)
          })
        }
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
        } else if (message.kind !== 'text') {
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
