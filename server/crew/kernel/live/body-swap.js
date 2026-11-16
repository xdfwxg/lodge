import { fail, ok } from '../../result.js'
import { roomBulletin, roomModeOfRoom } from '../../rooms/kinds.js'
import { resolveRoomType } from '../../room-types/index.js'

const roleKindOf = member => member.roleKind ?? member.role
const engineKindOf = (instances, id) => instances.find(item => item.id === id)?.engine ?? id

// 换身体只换载体，不换人：成员的 id、交接、证据和历史都留在房间里。
const independenceAfterSwap = ({ members, engines, instances, current }) => {
  const verifiers = members.filter(member => roleKindOf(member) === 'verifier')
  if (verifiers.length === 0) return 'human'
  const workers = members.filter(member => roleKindOf(member) === 'executor' || roleKindOf(member) === 'worker')
  if (workers.length === 0) return current
  const workerKinds = new Set(workers.map(member => engineKindOf(instances, engines[member.id])))
  return verifiers.every(member => !workerKinds.has(engineKindOf(instances, engines[member.id])))
    ? 'vendor'
    : 'none'
}

const labelOf = (instances, engineId, model) => {
  const instance = instances.find(item => item.id === engineId)
  return `${instance?.name ?? engineId}${model === undefined || model === '' ? '' : ` · ${model}`}`
}

export const createBodySwap = ({ store, engine, emit, attachMember, detachMember }) => {
  const swap = async (room, body = {}) => {
    const memberId = typeof body.memberId === 'string' ? body.memberId : ''
    const member = (room.members ?? []).find(item => item.id === memberId)
    if (member === undefined || typeof member.body?.ref !== 'string' || member.body.ref === '') {
      return fail('invalid', '没有这个成员的身体')
    }
    if (room.state !== 'active' && room.state !== 'paused') {
      return fail('conflict', '房间已经结束，不能再换身体')
    }
    if (typeof room.connectionError === 'string' && room.connectionError !== '') {
      return fail('conflict', '基座连接中断，等连上再换')
    }
    if (room.busy === true || (room.presence ?? []).some(item => item.state === 'working') || (room.turnQueue ?? []).length > 0) {
      return fail('conflict', '房间正在做事，等这一回合结束再换身体')
    }
    if (room.pauseReason === 'approval') return fail('conflict', '先处理待确认的操作，再换身体')
    if ((room.approvals ?? []).some(item => item.state === 'pending' && item.memberId === memberId)) {
      return fail('conflict', '这个成员还有待确认的操作，先处理掉再换身体')
    }
    const engineId = typeof body.engine === 'string' ? body.engine.trim() : ''
    const modelId = typeof body.model === 'string' ? body.model.trim() : ''
    if (engineId === '') return fail('invalid', '先选一个模型服务')
    let instances = []
    try {
      instances = await engine.instances()
    } catch {
      instances = []
    }
    const instance = instances.find(item => item.id === engineId)
    if (instance === undefined || instance.available !== true) return fail('invalid', '这个模型服务现在不可用')
    const requiresGate = resolveRoomType(room.roomType)?.readOnly !== true && member.permissions?.exec === true
    if (requiresGate && instance.capabilities?.approvalReview !== true) {
      return fail('invalid', '这个模型不会先问你，不能用来执行')
    }
    if (engineId === member.body.engine && modelId === (member.body.model ?? '')) {
      return fail('invalid', '身体没有变化')
    }

    const oldBody = { ...member.body }
    let created = null
    let baseRoom = null
    let sharedUpdated = false
    let stored = false
    try {
      created = await engine.createMemberBot({
        name: member.name,
        soul: roomModeOfRoom(room)?.memberSoul?.(member) ?? member.prompt ?? '',
        description: member.station,
        approval: member.approval,
        mcp: member.mcp,
        engine: instance.id,
        model: modelId === '' ? undefined : modelId,
      })
      baseRoom = await engine.createRoom({
        name: `${room.name} · ${member.name}`,
        goal: room.goal,
        bulletin: roomBulletin(room.goal, room.verify ?? 'manual', room.acceptance ?? '', room.handoff ?? null),
        members: [created.id],
        cwd: room.worktrees?.[member.id] ?? room.repoPath,
        leadId: created.id,
      })
      const sharedRoomId = room.chatRoom?.id
      if (typeof sharedRoomId === 'string' && sharedRoomId !== '') {
        const refs = (room.members ?? [])
          .map(item => (item.id === memberId ? created.id : item.body?.ref))
          .filter(ref => typeof ref === 'string' && ref !== '')
        if (room.chatHost?.memberRef) refs.push(room.chatHost.memberRef)
        await engine.updateRoomMembers(sharedRoomId, [...new Set(refs)])
        sharedUpdated = true
      }

      detachMember?.(room.id, memberId)
      const engines = { ...(room.engines ?? {}), [memberId]: created.engine }
      const models = { ...(room.models ?? {}), [memberId]: created.model ?? '' }
      const updated = store.updateRoom(room.id, current => {
        const target = (current.members ?? []).find(item => item.id === memberId)
        if (target === undefined) return null
        target.body = {
          kind: 'base',
          ref: created.id,
          name: created.name,
          roomRef: baseRoom.id,
          sessionRef: baseRoom.sessionRef,
          engine: created.engine,
          ...(created.model === undefined ? {} : { model: created.model }),
        }
        current.engines = engines
        current.models = models
        current.independence = independenceAfterSwap({
          members: current.members,
          engines,
          instances,
          current: current.independence,
        })
        if (current.pauseReason === 'member_error' && current.memberError?.memberId === memberId) {
          current.state = 'active'
          current.pauseReason = null
          current.idle = false
          delete current.memberError
        }
        return {
          events: [{
            type: 'member.body.swapped',
            payload: {
              memberId,
              from: { ref: oldBody.ref, engine: oldBody.engine, model: oldBody.model ?? '' },
              to: { ref: created.id, engine: created.engine, model: created.model ?? '' },
            },
          }],
        }
      })
      if (updated === null) throw new Error('房间状态已变化，身体没有写入')
      stored = true
      try {
        await attachMember?.(room.id, memberId)
      } catch (error) {
        store.appendMessage(room.id, {
          kind: 'system',
          text: `${member.name}的身体已经换好，但连接还没接上；稍后重试会自动连上（${error?.message ?? error}）。`,
        })
      }
      store.appendMessage(room.id, {
        kind: 'system',
        text: `${member.name}换好了身体：${labelOf(instances, oldBody.engine, oldBody.model)} → ${labelOf(instances, created.engine, created.model)}。历史不变，接着做。`,
      })
      if (typeof oldBody.roomRef === 'string' && oldBody.roomRef !== '') {
        try { await engine.deleteRoom(oldBody.roomRef) } catch {}
      }
      if (typeof oldBody.ref === 'string' && oldBody.ref !== '') {
        try { await engine.deleteMemberBot(oldBody.ref) } catch {}
      }
      emit('room', store.readRoom(room.id) ?? updated)
      return ok({ room: updated, memberId })
    } catch (error) {
      if (!stored) {
        if (sharedUpdated === true && typeof room.chatRoom?.id === 'string') {
          try {
            const refs = (room.members ?? [])
              .map(item => item.body?.ref)
              .filter(ref => typeof ref === 'string' && ref !== '')
            if (room.chatHost?.memberRef) refs.push(room.chatHost.memberRef)
            await engine.updateRoomMembers(room.chatRoom.id, [...new Set(refs)])
          } catch {}
        }
        if (baseRoom !== null) {
          try { await engine.deleteRoom(baseRoom.id) } catch {}
        }
        if (created !== null) {
          try { await engine.deleteMemberBot(created.id) } catch {}
        }
      }
      return fail('conflict', `换身体没完成：${error?.message ?? error}`)
    }
  }

  return { swap }
}
