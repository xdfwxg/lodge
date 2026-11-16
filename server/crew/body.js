import { bodyIssueOf } from './body-check.js'

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
    const skills = Array.isArray(spec.skills) ? spec.skills : []
    const mcp = Array.isArray(spec.mcp) ? spec.mcp : []
    const bodySpec = {
      prompt: typeof spec.prompt === 'string' ? spec.prompt : '',
      skills,
      mcp,
    }
    const memberRef = await engine.createMemberBot({
      name: member.name,
      soul: config.soul,
      description: member.station,
      approval: member.approval,
      mcp,
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
        },
      }
    } catch (error) {
      try { await engine.deleteMemberBot(memberRef.id) } catch {}
      throw error
    }
  }

  // 共享基座房间的成员是整体替换；调用方给出完整的 ref 列表。
  const join = async ({ sharedRoomId, refs }) => {
    if (typeof sharedRoomId !== 'string' || sharedRoomId === '') return false
    await engine.updateRoomMembers(sharedRoomId, [...new Set(refs.filter(ref => typeof ref === 'string' && ref !== ''))])
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

  return { instances, healthOf, incarnate, join, retire }
}
