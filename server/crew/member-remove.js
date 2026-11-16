import { fail, ok } from './result.js'
import { createBodyFactory } from './body.js'
import { independenceOf } from './independence.js'

const without = (map, id) => Object.fromEntries(Object.entries(map ?? {}).filter(([key]) => key !== id))
const ACTIVE_ASSIGNMENT = new Set(['sent', 'working', 'reported'])

// 移除 Bot 就是移除房间里的这条成员记录；身体退役、工位撤掉，历史留在房间里。
export const createMemberRemove = ({ store, engine, emit, detachMember, workspace }) => {
  const bodies = createBodyFactory({ engine })
  const remove = async (room, body = {}) => {
    const memberId = typeof body.memberId === 'string' ? body.memberId : ''
    const member = (room.members ?? []).find(item => item.id === memberId)
    if (member === undefined) return fail('invalid', '没有这个成员')
    if (room.state !== 'active' && room.state !== 'paused') return fail('conflict', '房间已经结束，不能移除成员')
    if (typeof room.connectionError === 'string' && room.connectionError !== '') return fail('conflict', '基座连接中断，等连上再移除')
    if (room.busy === true || (room.presence ?? []).some(item => item.state === 'working') || (room.turnQueue ?? []).length > 0) {
      return fail('conflict', '房间正在做事，等这一回合结束再移除')
    }
    if (room.pauseReason === 'approval') return fail('conflict', '先处理待确认的操作，再移除成员')
    if ((room.approvals ?? []).some(item => item.state === 'pending' && item.memberId === memberId)) {
      return fail('conflict', '这个成员还有待确认的操作，先处理掉再移除')
    }
    const kind = member.roleKind ?? member.role
    if (kind === 'planner' || kind === 'lead' || member.id === room.leadMemberId) {
      return fail('invalid', '主机器人不能移除；房间需要一个规划师')
    }
    const activeAssignments = typeof store.readAssignments === 'function'
      ? store.readAssignments(room.id, { limit: 5000 })
      : []
    if (activeAssignments.some(assignment => (
      ACTIVE_ASSIGNMENT.has(assignment.status) &&
      (assignment.toMemberId === memberId || assignment.fromMemberId === memberId)
    ))) {
      return fail('conflict', '这个成员手里还有没结束的交接，先处理交接再移除')
    }

    const instances = await bodies.instances()
    const members = (room.members ?? []).filter(item => item.id !== memberId)
    const engines = without(room.engines, memberId)
    const independence = independenceOf({ members, engines, instances })
    const updated = store.updateRoom(room.id, current => {
      const target = (current.members ?? []).find(item => item.id === memberId)
      if (target === undefined) return null
      current.members = (current.members ?? []).filter(item => item.id !== memberId)
      current.engines = without(current.engines, memberId)
      current.models = without(current.models, memberId)
      current.worktrees = without(current.worktrees, memberId)
      current.branches = without(current.branches, memberId)
      current.ports = without(current.ports, memberId)
      current.workspaceEnv = without(current.workspaceEnv, memberId)
      current.memberCursors = without(current.memberCursors, memberId)
      current.removedMembers = {
        ...(current.removedMembers ?? {}),
        [memberId]: {
          name: target.name,
          role: target.role,
          roleKind: target.roleKind ?? target.role,
          at: Date.now(),
        },
      }
      current.independence = independence
      return {
        events: [{
          type: 'member.removed',
          payload: { memberId, role: target.role, engine: target.body?.engine ?? '' },
        }],
      }
    })
    if (updated === null) return fail('conflict', '房间状态已变化，成员没有移除')

    detachMember?.(room.id, memberId)
    const refs = (room.members ?? [])
      .filter(item => item.id !== memberId)
      .map(item => item.body?.ref)
      .filter(ref => typeof ref === 'string' && ref !== '')
    if (room.chatHost?.memberRef) refs.push(room.chatHost.memberRef)
    try {
      await bodies.join({ sharedRoomId: room.chatRoom?.id, refs })
    } catch (error) {
      store.appendMessage(room.id, {
        kind: 'system',
        text: `${member.name}已经移出房间，但基座成员列表没同步成功；下次操作会自动纠正。`,
      })
    }
    await bodies.retire(member.body)
    const provider = workspace.provider(room)
    if (typeof provider.removeMember === 'function') {
      try { provider.removeMember({ room, member }) } catch {}
    }
    store.appendMessage(room.id, {
      kind: 'system',
      text: `把${member.name}移出了房间；历史还在。`,
    })
    emit('room', store.readRoom(room.id) ?? updated)
    return ok({ room: updated, memberId })
  }

  return { remove }
}
