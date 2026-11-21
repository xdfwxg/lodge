import { fail, ok } from '../../result.js'
import { roomModeOfRoom } from '../../rooms/kinds.js'
import { resolveRoomType } from '../../rooms/kinds.js'
import { engineBlockReason } from '../../../../shared/engine-readiness.js'
import { bodyChangeBlocker } from '../../body-change.js'
import { normalizeBodySpec } from '../../body-spec.js'
import { mergeRoleSkills } from '../../../../shared/role-toolbox.js'
import { grantBrowserToAll } from '../../room-access.js'
import { isBrowserGrant } from '../../../../shared/room-access.js'
import { plainRuntimeError } from '../../base-error.js'
import { independenceOf } from '../../independence.js'
import { roomToolsFor } from '../../gate/tool.js'
import { toolScopeFor } from '../../tool-scope.js'

const labelOf = (instances, engineId, model) => {
  const instance = instances.find(item => item.id === engineId)
  return `${instance?.name ?? engineId}${model === undefined || model === '' ? '' : ` · ${model}`}`
}

export const createBodySwap = ({ store, engine, emit }) => {
  const swap = async (room, body = {}) => {
    const memberId = typeof body.memberId === 'string' ? body.memberId : ''
    const member = (room.members ?? []).find(item => item.id === memberId)
    if (member === undefined || typeof member.body?.ref !== 'string' || member.body.ref === '') {
      return fail('invalid', '没有这个成员')
    }
    const blocked = bodyChangeBlocker(room, '调整成员')
    if (blocked !== null) return fail('conflict', blocked)
    if ((room.approvals ?? []).some(item => item.state === 'pending' && item.memberId === memberId)) {
      return fail('conflict', '先处理掉待确认的操作，再调整。')
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
    const hasSpec = member.body?.spec !== undefined && member.body?.spec !== null
    const providedSpec = body.prompt !== undefined || body.skills !== undefined || body.mcp !== undefined
    if (!hasSpec && !providedSpec) {
      return fail('invalid', '先补上行为说明、技能和工具连接，再保存。')
    }
    const currentSpec = member.body?.spec ?? {}
    const current = {
      prompt: typeof currentSpec.prompt === 'string' ? currentSpec.prompt : '',
      skills: Array.isArray(currentSpec.skills) ? currentSpec.skills : [],
      mcp: Array.isArray(currentSpec.mcp) ? currentSpec.mcp : [],
    }
    const { spec, error: specError } = normalizeBodySpec({
      input: { prompt: body.prompt, skills: body.skills, mcp: body.mcp },
      fallback: current,
    })
    if (specError !== undefined) return fail('invalid', specError)
    spec.skills = mergeRoleSkills(
      member.roleKind === 'participant' ? 'participant' : member.role,
      spec.skills,
    )
    spec.mcp = grantBrowserToAll([{ mcp: spec.mcp }])[0].mcp
    if ((member.role === 'lead' || member.role === 'verifier') && spec.mcp.some(grant => !isBrowserGrant(grant))) {
      return fail('invalid', '规划师和验收员只能使用只读浏览器，不能挂其他外部工具。')
    }
    const instance = instances.find(item => item.id === engineId)
    const requiresGate = resolveRoomType(room.roomType)?.readOnly !== true && member.permissions?.exec === true
    const issue = engineBlockReason(instance, { requireApproval: requiresGate })
    if (issue !== '') {
      if (issue === '登录失效') return fail('invalid', '这个模型服务还没登录，先登录。')
      if (issue === '不会先问你外部动作') return fail('invalid', '这个模型不会先问你，不能用来执行')
      return fail('invalid', issue === '没有这个模型服务' ? '这个模型服务现在不可用' : `这个模型服务现在不可用：${issue}`)
    }
    if (engineId === member.body.engine && modelId === (member.body.model ?? '') && JSON.stringify(spec) === JSON.stringify(current)) {
      return fail('invalid', '还没有改动')
    }

    const oldBody = { ...member.body }
    const model = modelId === '' ? (instance.models?.default ?? oldBody.model ?? '') : modelId
    const selection = { instanceId: instance.id, ...(model === '' ? {} : { model }) }
    const soul = roomModeOfRoom(room)?.memberSoul?.({
      ...member,
      prompt: spec.prompt,
      skills: spec.skills,
      mcp: spec.mcp,
    }) ?? spec.prompt
    try {
      // 换的是同一具身体：在同一个成员线程上换模型和设定，历史不重开。
      await engine.patchMemberBot(member.body.ref, {
        soul,
        description: member.station,
        approval: member.approval,
        mcp: spec.mcp,
        roomTools: roomToolsFor(member),
        toolScope: toolScopeFor(member),
        modelSelection: selection,
      })
      // 没有技能可改时不去碰基座的技能库；聊天室成员本来就不挂工具。
      if (JSON.stringify(spec.skills) !== JSON.stringify(current.skills)) {
        await engine.setBotSkills(member.body.ref, spec.skills)
      }
      const updated = store.updateRoom(room.id, current => {
        const target = (current.members ?? []).find(item => item.id === memberId)
        if (target === undefined) return null
        target.body = {
          ...oldBody,
          engine: instance.id,
          ...(model === '' ? {} : { model }),
          spec,
        }
        current.independence = independenceOf({ members: current.members, instances })
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
              to: { ref: oldBody.ref, engine: instance.id, model },
            },
          }],
        }
      })
      if (updated === null) throw new Error('房间状态已经变化，成员设置没有写入')
      store.appendMessage(room.id, {
        kind: 'system',
        text: `${member.name}调整好了：${labelOf(instances, oldBody.engine, oldBody.model)} → ${labelOf(instances, instance.id, model)}。历史不变，接着做。`,
      })
      emit('room', store.readRoom(room.id) ?? updated)
      return ok({ room: updated, memberId })
    } catch (error) {
      return fail('conflict', `没能保存：${plainRuntimeError(error)}`)
    }
  }

  return { swap }
}
