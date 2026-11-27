// 一间房「停没停、是不是在等人」只有这一个入口。界面、侧栏、灵动岛、评测都读这里，
// 别处不许再各判一次——同一个事实散成几套说法，就会出现“卡上说等人、平台其实在干活”。
//
// 顺序：
// 1. 房间级的人的事：审批卡、基座的问答卡、连接断了。
// 2. 阶段级的显式停住（blocked）：超时、重启、没进展、检查没过、规划师没给方案。
//    越界读不在其中——平台停的是那一位成员，接着用其余人的结果走，不是等人。
// 3. 房间级的暂停：连接、确认超时、额度、成员出错、用户自己停的。
// 4. 房型的待办：工作室的复核/返工/签署，聊天室的成员出错。房型只回答“这一步缺什么”，
//    「平台还有没有活」这份事实在 in-flight.js，两边共用。
import { failureLabel, failureNextStep } from '../../shared/failure.js'
import { pendingApprovals } from './external-actions.js'
import { roomPresentationOfRoom } from './rooms/kinds.js'
import { memberDisplayName } from './member-labels.js'
import { blockedSignalOf } from './blocked.js'
import { answeredCardIds, scopeIsValid } from '../../shared/attempt.js'
import { PAUSE_REASON, ROOM_STATE } from '../../shared/states.js'

// 唯一的入口：停下来要人处理的，返回一条能直接显示的信号；没停返回 null。
export const stopOf = (room, messages = []) => {
  if (room === null || room === undefined) return null
  const active = room.state === ROOM_STATE.active

  // 1. 房间级的人的事：人不动，平台不会继续。
  if (active) {
    const approvals = pendingApprovals(room).filter(item => scopeIsValid(item.scope, { room, messages }))
    if (approvals.length > 0) return { kind: 'approval', stage: null, label: '待确认' }
    // 基座的问答卡也在等人：最后一张没回答、且仍属于当前这一步的卡，才算数。
    const answered = answeredCardIds(room, messages)
    const card = [...messages].reverse().find(message => (
      message.kind === 'question' &&
      typeof message.meta?.card?.requestId === 'string' &&
      !answered.has(message.meta.card.requestId) &&
      scopeIsValid(message.meta.card.scope, { room, messages })
    ))
    if (card !== undefined) {
      return card.meta.card.requestType === 'permission'
        ? { kind: 'approval', stage: null, label: '有一个操作要你点头', detail: '允许或拒绝后，这一步继续。' }
        : { kind: 'question', stage: null, label: '待回答', detail: '有成员在等你的回答。' }
    }
    if (room.live === true && typeof room.connectionError === 'string' && room.connectionError !== '') {
      return { kind: 'connection', stage: null, label: '连接断了', detail: '模型服务掉线了；Lodge 会自动重连，也可以点重试。' }
    }
    // 2. 阶段级显式停住：平台上确实没有活了，说清楚为什么。
    const blocked = blockedSignalOf(room)
    if (blocked !== null) return blocked
  }

  // 3. 房间级暂停。
  if (room.state === ROOM_STATE.paused) {
    if (room.pauseReason === PAUSE_REASON.mcp) return { kind: 'mcp', stage: null, label: '连接中断' }
    if (room.pauseReason === PAUSE_REASON.approval) return { kind: 'approval', stage: null, label: '确认超时' }
    if (room.pauseReason === PAUSE_REASON.budget) {
      return {
        kind: 'budget',
        stage: null,
        label: '这一轮的额度用完了',
        detail: '充值或调高预算后，点“继续”。',
      }
    }
    if (room.pauseReason === PAUSE_REASON.member_error) {
      const memberId = room.memberError?.memberId
      const name = memberId === undefined ? '成员' : memberDisplayName(room, memberId)
      return {
        kind: 'error',
        stage: null,
        label: failureLabel(room.memberError?.kind, name),
        detail: failureNextStep(room.memberError?.kind),
      }
    }
    return room.idle === true ? { kind: 'idle', stage: null, label: '可以接着聊' } : null
  }
  if (!active) return null

  // 4. 房型自己的待办。房型只回答“这一步缺什么”，不再各写一份「停没停」。
  return roomPresentationOfRoom(room)?.stopOf?.(room, messages) ?? null
}
