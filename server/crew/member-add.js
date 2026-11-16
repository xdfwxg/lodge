import { fail, ok } from './result.js'
import { createBodyFactory } from './body.js'
import { bodyIssueOf } from './body-check.js'
import { independenceOf } from './independence.js'
import { roomBulletin, roomModeOfRoom } from './rooms/kinds.js'
import { resolveRoomType } from './room-types/index.js'
import { membersFor } from './roster.js'

const ROLE_ALIASES = { worker: 'worker', executor: 'worker', verifier: 'verifier' }
const ROLE_LABEL = { worker: '执行官', verifier: '验收员' }

const uniqueId = (room, role) => {
  const used = new Set((room.members ?? []).map(member => member.id))
  if (!used.has(role)) return role
  let index = 2
  while (used.has(`${role}-${index}`)) index += 1
  return `${role}-${index}`
}

// 添加 Bot 不是新增全局实体：往 room.members 追加一条带 body 的成员。
export const createMemberAdd = ({ store, engine, emit, attachMember, workspace }) => {
  const bodies = createBodyFactory({ engine })
  const add = async (room, body = {}) => {
    if (resolveRoomType(room.roomType)?.id !== 'studio') return fail('invalid', '聊天室暂不支持添加成员')
    if (room.state !== 'active' && room.state !== 'paused') return fail('conflict', '房间已经结束，不能再加成员')
    if (typeof room.connectionError === 'string' && room.connectionError !== '') return fail('conflict', '基座连接中断，等连上再加')
    if (room.busy === true || (room.presence ?? []).some(item => item.state === 'working') || (room.turnQueue ?? []).length > 0) {
      return fail('conflict', '房间正在做事，等这一回合结束再加')
    }
    if (room.pauseReason === 'approval') return fail('conflict', '先处理待确认的操作，再加成员')
    const role = ROLE_ALIASES[typeof body.role === 'string' ? body.role : '']
    if (role === undefined) return fail('invalid', '只能添加执行官或验收员；房间只有一个主机器人')
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 32) : ''
    if (name === '') return fail('invalid', '先给成员起个名字')
    if ((room.members ?? []).some(member => String(member.name ?? '').toLowerCase() === name.toLowerCase())) {
      return fail('invalid', '房间里已经有同名成员')
    }
    const provider = workspace.provider(room)
    if (typeof provider.addMember !== 'function') return fail('conflict', '当前工作文件夹类型还不支持添加成员')

    const instances = await bodies.instances()
    const requested = typeof body.engine === 'string' ? body.engine.trim() : ''
    const instance = requested !== ''
      ? instances.find(item => item.id === requested)
      : instances.find(item => item.available === true && item.authenticated !== false && item.capabilities?.approvalReview === true)
    if (instance === undefined || instance.available !== true) return fail('invalid', '这个模型服务现在不可用')
    const health = bodyIssueOf(instance)
    if (health !== '') {
      return fail('invalid', health === '登录失效' ? '这个模型服务没有登录，先登录再加' : `这个模型服务现在不可用：${health}`)
    }
    if (instance.capabilities?.approvalReview !== true) return fail('invalid', '执行成员要用会先问你外部动作的模型')
    const model = typeof body.model === 'string' && body.model.trim() !== ''
      ? body.model.trim()
      : (instance.models?.default ?? '')

    const template = membersFor('delivery-triad').find(member => member.role === role)
    const id = uniqueId(room, role)
    const verifierRefs = (room.members ?? [])
      .filter(member => (member.roleKind ?? member.role) === 'verifier')
      .map(member => `@${member.name}`)
      .join('、') || '@验收员'
    const prompt = template.prompt
      .replaceAll('你是执行官', `你是${name}`)
      .replaceAll('你是验收员', `你是${name}`)
      .replaceAll('@验收员', verifierRefs)
    const mode = roomModeOfRoom(room)
    const spec = { ...template, id, name, engine: instance.id, model, prompt, engineExplicit: true }
    Object.assign(spec, mode.memberRole?.(spec) ?? {})
    const soul = mode.memberSoul?.(spec) ?? prompt

    let memberWorkspace = null
    let incarnation = null
    let sharedUpdated = false
    try {
      memberWorkspace = provider.addMember({ room, member: spec })
      incarnation = await bodies.incarnate({
        member: spec,
        config: { engine: instance.id, model, soul },
        thread: {
          name: `${room.name} · ${name}`,
          goal: room.goal,
          bulletin: roomBulletin(room.goal, room.verify ?? 'manual', room.acceptance ?? '', room.handoff ?? null),
          cwd: memberWorkspace.path,
        },
      })
      workspace.writeMemberEnv({ room: { id: room.id }, memberId: id, path: memberWorkspace.path, port: memberWorkspace.port })
      const refs = [...(room.members ?? []).map(member => member.body?.ref), incarnation.body.ref]
      if (room.chatHost?.memberRef) refs.push(room.chatHost.memberRef)
      sharedUpdated = await bodies.join({ sharedRoomId: room.chatRoom?.id, refs })

      const engines = { ...(room.engines ?? {}), [id]: incarnation.body.engine }
      const models = { ...(room.models ?? {}), [id]: model }
      const updated = store.updateRoom(room.id, current => {
        current.members = [...(current.members ?? []), {
          id,
          kind: 'ai',
          name,
          title: template.title,
          role: template.role,
          roleKind: spec.roleKind ?? (role === 'worker' ? 'executor' : 'verifier'),
          roleProfile: spec.roleProfile ?? name,
          station: template.station,
          engine: instance.id,
          ...(model === '' ? {} : { model }),
          approvalGate: true,
          permissions: template.permissions,
          writeScope: template.writeScope,
          toolSurface: template.toolSurface,
          skills: template.skills,
          mcp: template.mcp,
          approval: template.approval,
          speakBudget: template.speakBudget,
          prompt,
          body: incarnation.body,
        }]
        current.engines = engines
        current.models = models
        current.worktrees = { ...(current.worktrees ?? {}), [id]: memberWorkspace.path }
        current.branches = { ...(current.branches ?? {}), [id]: memberWorkspace.branch }
        current.ports = { ...(current.ports ?? {}), [id]: memberWorkspace.port }
        current.workspaceEnv = { ...(current.workspaceEnv ?? {}), [id]: memberWorkspace.environment }
        current.independence = independenceOf({ members: current.members, engines, instances })
        return {
          events: [{
            type: 'member.added',
            payload: { memberId: id, role, engine: incarnation.body.engine, model },
          }],
        }
      })
      if (updated === null) throw new Error('房间状态已变化，成员没有写入')
      try {
        await attachMember?.(room.id, id)
      } catch (error) {
        store.appendMessage(room.id, {
          kind: 'system',
          text: `${name}已经加进房间，但连接还没接上；稍后重试会自动连上（${error?.message ?? error}）。`,
        })
      }
      store.appendMessage(room.id, {
        kind: 'system',
        text: `给房间加了一位${ROLE_LABEL[role]}：${name}（${instance.name ?? instance.id}${model === '' ? '' : ` · ${model}`}）。`,
      })
      emit('room', store.readRoom(room.id) ?? updated)
      return ok({ room: updated, memberId: id })
    } catch (error) {
      if (sharedUpdated === true && typeof room.chatRoom?.id === 'string') {
        try {
          const refs = (room.members ?? []).map(member => member.body?.ref)
          if (room.chatHost?.memberRef) refs.push(room.chatHost.memberRef)
          await bodies.join({ sharedRoomId: room.chatRoom.id, refs })
        } catch {}
      }
      if (incarnation !== null) await bodies.retire(incarnation.body)
      if (memberWorkspace !== null && typeof provider.removeMember === 'function') {
        try { provider.removeMember({ room, member: spec }) } catch {}
      }
      return fail('conflict', `成员没加进去：${error?.message ?? error}`)
    }
  }

  return { add }
}
