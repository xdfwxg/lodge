import * as log from './log.js'
import { bodyIssueOf } from './body-check.js'
import { ensureGateServer, roomToolsFor } from './gate/tool.js'
import { toolScopeFor } from './tool-scope.js'
import { mergeRoleSkills } from '../../shared/role-toolbox.js'

// 身体工厂：只负责让一具基座身体上线、进入共享房间、退役。
// 成员身份、权限、交接、房间状态都不在这里；建房、换身体、添加成员共用这一条路。
export const createBodyFactory = ({ engine }) => {
  const instances = async () => {
    try {
      return await engine.instances()
    } catch {
      return []
    }
  }

  const healthOf = (engineId, list) => bodyIssueOf(list.find(item => item.id === engineId))

  const incarnate = async ({ member, config, thread }) => {
    const spec = config.spec ?? {}
    const skills = mergeRoleSkills(
      member.roleKind === 'participant' ? 'participant' : member.role,
      Array.isArray(spec.skills) ? spec.skills : [],
    )
    const mcp = Array.isArray(spec.mcp) ? spec.mcp : []
    const bodySpec = {
      prompt: typeof spec.prompt === 'string' ? spec.prompt : '',
      skills,
      mcp,
    }
    let roomTools = roomToolsFor(member)
    if (roomTools.length > 0) {
      try {
        // 返回 false 表示 runtime 没有 MCP 能力：工具没挂上，判定只能走文本降级。
        const registered = await ensureGateServer(engine)
        if (registered !== true) roomTools = []
      } catch (error) {
        log.warn(`[lodge] 判定工具没能注册，先用文本判定：${error?.message ?? error}`)
        roomTools = []
      }
    }
    const memberRef = await engine.createMemberBot({
      name: member.name,
      soul: config.soul,
      description: member.station,
      approval: member.approval,
      mcp,
      roomTools,
      toolScope: toolScopeFor(member),
      engine: config.engine,
      model: config.model,
    })
    try {
      if (skills.length > 0) {
        try {
          await engine.setBotSkills(memberRef.id, skills)
        } catch (error) {
          throw new Error(`技能没挂上（${member.name}）：${error?.message ?? error}`)
        }
      }
      const baseRoom = await engine.createRoom({
        name: thread.name,
        goal: thread.goal,
        bulletin: thread.bulletin,
        members: [memberRef.id],
        cwd: thread.cwd,
        leadId: memberRef.id,
        followMentions: false,
      })
        return {
        memberRef,
        baseRoom,
        body: {
          kind: 'base',
          ref: memberRef.id,
          name: memberRef.name,
          roomRef: baseRoom.id,
          sessionRef: baseRoom.sessionRef,
          engine: memberRef.engine,
          ...(memberRef.model === undefined ? {} : { model: memberRef.model }),
          spec: bodySpec,
          // 判定工具是否真的挂上，决定复核时能不能只认工具提交；注册失败时这里为空。
          ...(roomTools.length === 0 ? {} : { roomTools: [...roomTools] }),
        },
      }
    } catch (error) {
      try { await engine.deleteMemberBot(memberRef.id) } catch {}
      throw error
    }
  }

  // 主持人只占一个基座席位，不占成员位置；创建和退役都留在身体适配层。
  const createHost = async ({ name, soul, description, approval, mcp = [] }) => engine.createMemberBot({
    name,
    soul,
    description,
    approval,
    mcp,
  })

  const retireHost = async ref => {
    if (typeof ref === 'string' && ref !== '') await engine.deleteMemberBot(ref)
  }

  // 共享基座房间的成员是整体替换；房间和主持人的基座地址留在这一层，不往业务层漏。
  const join = async ({ room, refs = [] }) => {
    const sharedRoomId = room?.chatRoom?.id
    if (typeof sharedRoomId !== 'string' || sharedRoomId === '') return false
    const allRefs = [...refs]
    if (typeof room?.chatHost?.memberRef === 'string' && room.chatHost.memberRef !== '') allRefs.push(room.chatHost.memberRef)
    await engine.updateRoomMembers(sharedRoomId, [...new Set(allRefs.filter(ref => typeof ref === 'string' && ref !== ''))])
    return true
  }

  const retire = async body => {
    if (typeof body?.roomRef === 'string' && body.roomRef !== '') {
      try { await engine.deleteRoom(body.roomRef) } catch {}
    }
    if (typeof body?.ref === 'string' && body.ref !== '') {
      try { await engine.deleteMemberBot(body.ref) } catch {}
    }
  }

  return { instances, healthOf, incarnate, createHost, retireHost, join, retire }
}
