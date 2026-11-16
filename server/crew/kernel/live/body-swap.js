import { fail, ok } from '../../result.js'
import { roomBulletin, roomModeOfRoom } from '../../rooms/kinds.js'
import { resolveRoomType } from '../../room-types/index.js'
import { bodyIssueOf } from '../../body-check.js'
import { independenceOf } from '../../independence.js'
import { createBodyFactory } from '../../body.js'

const labelOf = (instances, engineId, model) => {
  const instance = instances.find(item => item.id === engineId)
  return `${instance?.name ?? engineId}${model === undefined || model === '' ? '' : ` · ${model}`}`
}

export const createBodySwap = ({ store, engine, emit, attachMember, detachMember }) => {
  const bodies = createBodyFactory({ engine })
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
    const chatRunning = room.chat?.running === true || room.chatWorking === true
    if (room.busy === true || chatRunning || (room.presence ?? []).some(item => item.state === 'working') || (room.turnQueue ?? []).length > 0) {
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
    const issue = bodyIssueOf(instance)
    if (issue !== '') return fail('invalid', issue === '登录失效' ? '这个模型服务没有登录，先登录再换身体' : `这个模型服务现在不可用：${issue}`)
    const requiresGate = resolveRoomType(room.roomType)?.readOnly !== true && member.permissions?.exec === true
    if (requiresGate && instance.capabilities?.approvalReview !== true) {
      return fail('invalid', '这个模型不会先问你，不能用来执行')
    }
    if (engineId === member.body.engine && modelId === (member.body.model ?? '')) {
      return fail('invalid', '身体没有变化')
    }

    const oldBody = { ...member.body }
    let incarnation = null
    let created = null
    let sharedUpdated = false
    let stored = false
    try {
      incarnation = await bodies.incarnate({
        member,
        config: {
          engine: instance.id,
          model: modelId === '' ? undefined : modelId,
          soul: roomModeOfRoom(room)?.memberSoul?.(member) ?? member.prompt ?? '',
        },
        thread: {
          name: `${room.name} · ${member.name}`,
          goal: room.goal,
          bulletin: roomBulletin(room.goal, room.verify ?? 'manual', room.acceptance ?? '', room.handoff ?? null),
          cwd: room.worktrees?.[member.id] ?? room.repoPath,
        },
      })
      created = incarnation.memberRef
      const sharedRoomId = room.chatRoom?.id
      const refs = (room.members ?? [])
        .map(item => (item.id === memberId ? created.id : item.body?.ref))
        .filter(ref => typeof ref === 'string' && ref !== '')
      if (room.chatHost?.memberRef) refs.push(room.chatHost.memberRef)
      sharedUpdated = await bodies.join({ sharedRoomId, refs })

      detachMember?.(room.id, memberId)
      const engines = { ...(room.engines ?? {}), [memberId]: created.engine }
      const models = { ...(room.models ?? {}), [memberId]: created.model ?? '' }
      const updated = store.updateRoom(room.id, current => {
        const target = (current.members ?? []).find(item => item.id === memberId)
        if (target === undefined) return null
        target.body = incarnation.body
        current.engines = engines
        current.models = models
        current.independence = independenceOf({ members: current.members, engines, instances })
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
      await bodies.retire(oldBody)
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
            await bodies.join({ sharedRoomId: room.chatRoom.id, refs })
          } catch {}
        }
        if (incarnation !== null) await bodies.retire(incarnation.body)
      }
      const raw = String(error?.message ?? error)
      const friendly = /this channel is working|waiting on you|finish that turn first/i.test(raw)
        ? '房间正在做事，等这一轮结束再换身体'
        : /base 404/i.test(raw) ? '基座里找不到这具身体，刷新后再试' : raw
      return fail('conflict', `换身体没完成：${friendly}`)
    }
  }

  return { swap }
}
