import { roomModeForType } from './rooms/kinds.js'
import * as chatType from './room-types/chat.js'
import * as studioType from './room-types/studio.js'
import { roleKindOf } from './roster.js'
import { roleDefinitionOf } from '../../shared/role-definitions.js'
import { leadMemberOf } from './room-members.js'
import { roomToolsFor } from './gate/tool.js'
import { toolScopeFor } from './tool-scope.js'
import { LODGE_HOST_LABEL } from './member-labels.js'
import { INTERNAL_PROMPT_MARKER } from './internal-prompts.js'
import { fail, ok } from './result.js'
import { systemNotice } from './notices.js'

const hostSoul = '你是 Lodge 的主持人。你只负责开场、总结和收敛讨论，不替发言者下结论；不要调用工具。'

const alignment = goal => [
  `目标：${goal}`,
  '验收方式：人确认，不跑命令',
  '用户确认阶段后，系统会发一条以「阶段已确认」开头的消息；收到这条消息后只派当前阶段。',
].join('\n')

const ROLE_BY_KIND = { planner: 'lead', executor: 'worker', verifier: 'verifier' }

// 聊天室成员没有工作室角色；切过去时按角色定义补上权限和工位，线程和复制目录不动。
const promoted = (member, kind) => {
  const definition = roleDefinitionOf(ROLE_BY_KIND[kind])
  return {
    ...member,
    role: definition.role,
    roleKind: kind,
    roleProfile: member.roleProfile ?? member.name,
    station: definition.station,
    permissions: { ...definition.permissions },
    writeScope: definition.writeScope,
    toolSurface: [...definition.toolSurface],
    approval: definition.approval,
  }
}

// 模式切换保留同一批成员、基座线程和群聊；只换房型状态和运行时。
export const createModeSwitch = ({ store, engine, live, emit }) => {
  const chatMode = roomModeForType('chat')
  const studioMode = roomModeForType('studio')
  const patchMember = async (member, { soul, mcp, roomTools }) => {
    if (typeof member?.body?.ref !== 'string' || member.body.ref === '') return
    await engine.patchMemberBot(member.body.ref, {
      soul,
      description: member.station,
      approval: member.approval,
      mcp,
      roomTools,
      toolScope: toolScopeFor(member),
      modelSelection: {
        instanceId: member.body.engine,
        ...(typeof member.body.model === 'string' && member.body.model !== '' ? { model: member.body.model } : {}),
      },
    })
  }

  const makeHost = async room => {
    const suffix = room.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8)
    const created = await engine.createMemberBot({
      name: `LodgeHost${suffix}`,
      soul: hostSoul,
      approval: 'ask',
      mcp: [],
      roomTools: [],
    })
    return { memberRef: created.id, name: created.name, displayName: LODGE_HOST_LABEL }
  }

  const switchMode = async (room, body = {}) => {
    const target = body.mode === 'chat' ? 'chat' : body.mode === 'studio' ? 'studio' : ''
    if (target === '') return fail('invalid', '只能切换到聊天室或工作室')
    if (room.roomType === target) return fail('conflict', '房间已经在这个房型')
    if ((room.busyMembers ?? []).length > 0 || room.chat?.running === true) {
      return fail('conflict', '房间还有回合在跑；先等这一回合结束')
    }
    if (room.live === true && typeof live.busyReview === 'function' && live.busyReview(room.id)) {
      return fail('conflict', '验收员还在看；等结论出来再切换')
    }
    if ((room.approvals ?? []).some(item => item?.state === 'pending')) {
      return fail('conflict', '还有待确认的操作；先处理掉再切换')
    }

    let members = (room.members ?? []).map(member => ({
      ...member,
      roleKind: roleKindOf(member.roleKind ?? member.role),
    }))
    let lead = members.find(member => member.roleKind === 'planner' || member.role === 'lead')
    let verifier = members.find(member => member.roleKind === 'verifier' || member.role === 'verifier')
    if (target === 'studio') {
      const picked = id => typeof id === 'string' ? members.find(member => member.id === id) : undefined
      const leadPick = lead ?? picked(body.plannerId)
      const verifierPick = verifier ?? picked(body.verifierId)
      if (leadPick === undefined) return fail('invalid', '切到工作室前，先选一位成员做规划师')
      if (verifierPick === undefined) return fail('invalid', '切到工作室前，先选一位成员做验收员')
      if (leadPick.id === verifierPick.id) return fail('invalid', '规划师和验收员不能是同一位')
      members = members.map(member => {
        if (member.id === leadPick.id) return promoted(member, 'planner')
        if (member.id === verifierPick.id) return promoted(member, 'verifier')
        return member.roleKind === 'executor' ? member : promoted(member, 'executor')
      })
      lead = members.find(member => member.id === leadPick.id)
      verifier = members.find(member => member.id === verifierPick.id)
    }

    let host = room.chatHost ?? null
    let createdHost = false
    try {
      if (target === 'studio') {
        for (const member of members) {
          const definition = roleDefinitionOf(member.roleKind === 'planner' ? 'lead' : member.roleKind === 'executor' ? 'worker' : member.roleKind)
          await patchMember(member, {
            soul: studioMode.memberSoul({
              ...member,
              prompt: definition?.prompt ?? member.body?.spec?.prompt ?? '',
            }),
            mcp: member.body?.spec?.mcp ?? [],
            roomTools: roomToolsFor({ role: member.role === 'lead' ? 'lead' : member.role }),
          })
        }
      } else {
        if (host === null) {
          host = await makeHost(room)
          createdHost = true
        }
        const refs = [
          ...members.map(member => member.body?.ref).filter(ref => typeof ref === 'string' && ref !== ''),
          host.memberRef,
        ]
        if (room.chatRoom?.id !== undefined && typeof engine.updateRoomMembers === 'function') {
          await engine.updateRoomMembers(room.chatRoom.id, [...new Set(refs)])
        }
        for (const member of members) {
          await patchMember(member, {
            soul: chatMode.memberSoul(member),
            mcp: [],
            roomTools: [],
          })
        }
      }
    } catch (error) {
      if (createdHost && host !== null) {
        try { await engine.deleteMemberBot(host.memberRef) } catch {}
      }
      const raw = String(error?.message ?? error)
      // 聊天刚给出结论时，基座还会把频道当成“等你收尾”；这是几秒钟的窗口，不是用户做错了什么。
      const reason = /working or waiting on you/.test(raw) ? '聊天室刚结束，还在收尾；几秒后再切换' : raw
      return fail('conflict', `没能切换：${reason}`)
    }

    if (room.live === true && live.isAttached?.(room.id) === true) live.detach?.(room.id)
    const updated = store.updateRoom(room.id, current => {
      current.members = members
      current.state = 'active'
      current.live = true
      current.roomType = target
      if (target === 'studio') {
        const built = studioType.buildStages({ title: current.goal, plan: null, verify: 'manual', acceptance: '', align: true })
        current.stages = built.stages
        current.plan = null
        current.verify = 'manual'
        current.acceptance = ''
        current.closure = 'open'
        current.verificationMode = 'hybrid'
        current.leadMemberId = lead.id
        current.stageBases = {}
        current.openQuestion = null
        current.busyMembers = []
        current.turnQueue = []
        current.constraints = ['工作室：阶段验收由证据与验收员决定']
      } else {
        const record = chatMode.record({ chatLimit: chatType.CHAT_TURNS_PER_ROUND })
        current.chat = record.chat
        current.constraints = record.constraints
        current.leadMemberId = null
        current.chatHost = host
      }
      return {
        events: [{
          type: 'room.mode',
          payload: { from: room.roomType, to: target },
        }],
      }
    })
    if (updated === null) return fail('conflict', '房间状态已经变化，再试一次')
    emit('room', updated)
    try {
      await live.attach?.(updated)
    } catch (error) {
      systemNotice({ store, roomId: room.id, text: '模式切换了，但连接还没接上；稍后会重试。', error })
    }
    if (target === 'studio' && typeof live.sendToMember === 'function') {
      const roomAfter = store.readRoom(room.id) ?? updated
      const leadAfter = leadMemberOf(roomAfter)
      if (leadAfter !== undefined) {
        try {
          const sent = await live.sendToMember(
            room.id,
            leadAfter.id,
            `${alignment(roomAfter.goal)}\n${INTERNAL_PROMPT_MARKER}`,
            { intent: 'align', from: 'Lodge' },
          )
          if (sent?.messageId !== undefined && sent?.messageId !== null) {
            store.updateRoom(room.id, current => {
              current.hiddenBaseMessages = [...(current.hiddenBaseMessages ?? []), sent.messageId].slice(-50)
              return { events: [] }
            })
          }
        } catch (error) {
          systemNotice({ store, roomId: room.id, text: '规划师没能开始重新对齐；需要你处理。', error })
        }
      }
    }
    store.appendMessage(room.id, {
      kind: 'system',
      text: target === 'chat' ? '已切换到聊天室；直接说话开始讨论。' : '已切换到工作室；规划师会重新对齐目标。',
    })
    return ok({ room: store.readRoom(room.id) ?? updated })
  }

  return { switchMode }
}
