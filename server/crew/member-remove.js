import { fail, ok } from './result.js'
import { createBodyFactory } from './body.js'
import { bodyChangeBlocker } from './body-change.js'
import { independenceOf } from './independence.js'
import { APPROVAL_STATE } from '../../shared/states.js'
import { roomModeOfRoom } from './rooms/kinds.js'

const without = (map, id) => Object.fromEntries(Object.entries(map ?? {}).filter(([key]) => key !== id))
const ACTIVE_ASSIGNMENT = new Set(['sent', 'working', 'reported'])

// 移除 Bot 就是移除房间里的这条成员记录；身体退役、工位撤掉，历史留在房间里。
export const createMemberRemove = ({ store, engine, emit, detachMember, workspace }) => {
  const bodies = createBodyFactory({ engine })
  const remove = async (room, body = {}) => {
    const memberId = typeof body.memberId === 'string' ? body.memberId : ''
    if (roomModeOfRoom(room)?.supportsMemberRemove === false) return fail('invalid', '这间房的成员不能移除')
    const member = (room.members ?? []).find(item => item.id === memberId)
    if (member === undefined) return fail('invalid', '没有这个成员')
    const blocked = bodyChangeBlocker(room, '移除成员')
    if (blocked !== null) return fail('conflict', blocked)
    if ((room.approvals ?? []).some(item => item.state === APPROVAL_STATE.pending && item.memberId === memberId)) {
      return fail('conflict', '先处理掉待确认的操作，再移除。')
    }
    const kind = member.roleKind ?? member.role
    if (kind === 'planner' || kind === 'lead' || member.id === room.leadMemberId) {
      return fail('invalid', '规划师不能移除。')
    }
    const activeAssignments = typeof store.readAssignments === 'function'
      ? store.readAssignments(room.id, { limit: 5000 })
      : []
    if (activeAssignments.some(assignment => (
      ACTIVE_ASSIGNMENT.has(assignment.status) &&
      (assignment.toMemberId === memberId || assignment.fromMemberId === memberId)
    ))) {
      return fail('conflict', '先处理完没结束的交接，再移除。')
    }

    const instances = await bodies.instances()
    const members = (room.members ?? []).filter(item => item.id !== memberId)
    const independence = independenceOf({ members, instances })
    const updated = store.updateRoom(room.id, current => {
      const target = (current.members ?? []).find(item => item.id === memberId)
      if (target === undefined) return null
      current.members = (current.members ?? []).filter(item => item.id !== memberId)
      current.worktrees = without(current.worktrees, memberId)
      current.branches = without(current.branches, memberId)
      current.ports = without(current.ports, memberId)
      current.workspaceEnv = without(current.workspaceEnv, memberId)
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
    try {
      await bodies.join({ room, refs })
    } catch (error) {
      store.appendMessage(room.id, {
        kind: 'system',
        text: `${member.name}已经移出房间；服务里的成员列表稍后会自动对齐。`,
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
