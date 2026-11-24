import { engineBlockReason, engineReady } from '../../shared/engine-readiness.js'
import { fail, ok } from './result.js'
import { systemNotice } from './notices.js'
import { createBodyFactory } from './body.js'
import { bodyChangeBlocker } from './body-change.js'
import { plainRuntimeError } from './base-error.js'
import { stagesCompletedOf } from '../../shared/room-status.js'
import { normalizeBodySpec } from './body-spec.js'
import { independenceOf } from './independence.js'
import { roomBulletin, roomModeOfRoom } from './rooms/kinds.js'
import { membersFor } from './roster.js'
import { grantBrowserToAll, stripBrowser } from './room-access.js'
import { isBrowserGrant } from '../../shared/room-access.js'

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
export const createMemberAdd = ({ store, engine, emit, attachMember, workspace, browserMcp = null }) => {
  const bodies = createBodyFactory({ engine })
  const add = async (room, body = {}) => {
    if (roomModeOfRoom(room)?.supportsMemberAdd !== true) return fail('invalid', '这间房不能添加成员')
    if (stagesCompletedOf(room)) {
      return fail('conflict', '房间已经交付，不能再加成员；要改成员，开一间新房')
    }
    const blocked = bodyChangeBlocker(room, '加成员')
    if (blocked !== null) return fail('conflict', blocked)
    const role = ROLE_ALIASES[typeof body.role === 'string' ? body.role : '']
    if (role === undefined) return fail('invalid', '只能添加执行官或验收员')
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 32) : ''
    if (name === '') return fail('invalid', '先给成员起个名字')
    if ((room.members ?? []).some(member => String(member.name ?? '').toLowerCase() === name.toLowerCase())) {
      return fail('invalid', '房间里已经有同名成员')
    }
    let browserReady = true
    if (browserMcp !== null) browserReady = (await browserMcp.ensure?.()) === true
    const provider = workspace.provider(room)
    if (typeof provider.addMember !== 'function') return fail('conflict', '这个工作文件夹还不支持添加成员')

    const instances = await bodies.instances()
    const requested = typeof body.engine === 'string' ? body.engine.trim() : ''
    const instance = requested !== ''
      ? instances.find(item => item.id === requested)
      : instances.find(item => engineReady(item, { requireApproval: true }))
    const issue = engineBlockReason(instance, { requireApproval: true })
    if (issue !== '') {
      if (issue === '登录失效') return fail('invalid', '这个模型服务还没登录。')
      if (issue === '不会先问你外部动作') return fail('invalid', '执行官要用会先问你的模型。')
      return fail('invalid', issue === '没有这个模型服务' ? '这个模型服务现在不可用' : `这个模型服务现在不可用：${issue}`)
    }
    const model = typeof body.model === 'string' && body.model.trim() !== ''
      ? body.model.trim()
      : (instance.models?.default ?? '')

    const template = membersFor('delivery-triad').find(member => member.role === role)
    const id = uniqueId(room, role)
    const defaultPrompt = template.prompt
      .replaceAll('你是执行官', `你是${name}`)
      .replaceAll('你是验收员', `你是${name}`)
    const { spec: bodySpec, error: specError } = normalizeBodySpec({
      input: { prompt: body.prompt, skills: body.skills, mcp: body.mcp },
      fallback: { prompt: defaultPrompt, skills: template.skills, mcp: template.mcp },
    })
    if (specError !== undefined) return fail('invalid', specError)
    const mode = roomModeOfRoom(room)
    const spec = {
      ...template,
      id,
      name,
      engine: instance.id,
      model,
      prompt: bodySpec.prompt,
      skills: bodySpec.skills,
      mcp: bodySpec.mcp,
      engineExplicit: true,
    }
    const granted = (browserReady ? grantBrowserToAll([spec]) : stripBrowser([spec]))[0]
    spec.mcp = granted.mcp
    bodySpec.mcp = granted.mcp
    if (role === 'verifier' && spec.mcp.some(grant => !isBrowserGrant(grant))) {
      return fail('invalid', '验收员只能使用只读浏览器，不能挂其他外部工具。')
    }
    Object.assign(spec, mode.memberRole?.(spec) ?? {})
    const soul = mode.memberSoul?.(spec) ?? bodySpec.prompt

    let memberWorkspace = null
    let incarnation = null
    let sharedUpdated = false
    try {
      memberWorkspace = provider.addMember({ room, member: spec })
      incarnation = await bodies.incarnate({
        member: spec,
        config: { engine: instance.id, model, soul, spec: bodySpec },
        thread: {
          name: `${room.name} · ${name}`,
          goal: room.goal,
          bulletin: roomBulletin(room.goal, room.verify ?? 'manual', room.acceptance ?? '', room.handoffBrief ?? null),
          cwd: memberWorkspace.path,
        },
      })
      workspace.writeMemberEnv({ room: { id: room.id }, memberId: id, path: memberWorkspace.path, port: memberWorkspace.port })
      const refs = [...(room.members ?? []).map(member => member.body?.ref), incarnation.body.ref]
      sharedUpdated = await bodies.join({ room, refs })

      const updated = store.updateRoom(room.id, current => {
        current.members = [...(current.members ?? []), {
          id,
          name,
          title: template.title,
          role: template.role,
          roleKind: spec.roleKind ?? (role === 'worker' ? 'executor' : 'verifier'),
          roleProfile: spec.roleProfile ?? name,
          station: template.station,
          permissions: template.permissions,
          writeScope: template.writeScope,
          toolSurface: template.toolSurface,
          approval: template.approval,
          body: incarnation.body,
        }]
        current.worktrees = { ...(current.worktrees ?? {}), [id]: memberWorkspace.path }
        current.branches = { ...(current.branches ?? {}), [id]: memberWorkspace.branch }
        current.ports = { ...(current.ports ?? {}), [id]: memberWorkspace.port }
        current.workspaceEnv = { ...(current.workspaceEnv ?? {}), [id]: memberWorkspace.environment }
        current.independence = independenceOf({ members: current.members, instances })
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
        systemNotice({
          store,
          roomId: room.id,
          text: `${name}已经加进房间，但连接还没接上；稍后重试会自动连上。`,
          error,
        })
      }
      store.appendMessage(room.id, {
        kind: 'system',
        text: `给房间加了一位${ROLE_LABEL[role]}：${name}（${instance.name ?? instance.id}${model === '' ? '' : ` · ${model}`}）。`,
      })
      if (!browserReady) {
        store.appendMessage(room.id, { kind: 'system', text: `${name}这次不查网页：浏览器没准备好。` })
      }
      emit('room', store.readRoom(room.id) ?? updated)
      return ok({ room: updated, memberId: id })
    } catch (error) {
      if (sharedUpdated === true) {
        try {
          const refs = (room.members ?? []).map(member => member.body?.ref)
          await bodies.join({ room, refs })
        } catch {}
      }
      if (incarnation !== null) await bodies.retire(incarnation.body)
      if (memberWorkspace !== null && typeof provider.removeMember === 'function') {
        try { provider.removeMember({ room, member: spec }) } catch {}
      }
      return fail('conflict', `没能添加成员：${plainRuntimeError(error)}`)
    }
  }

  return { add }
}
