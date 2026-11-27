import * as log from '../../log.js'
import { fail, ok } from '../../result.js'
import { OPEN_ROUND_STATUSES, ROOM_STATE } from '../../../../shared/states.js'
import { roomDeletableNow } from '../../../../shared/room-status.js'
import { PROMISE_STATUS } from '../../../../shared/promise.js'
import { disarmPromise } from '../../promise/queue.js'
import {
  approvalOf,
  networkModeOf,
  normalizeRoomPolicy,
  policySummaryOf,
  roomPolicyOf,
} from '../../../../shared/room-policy.js'
import { bodyChangeBlocker } from '../../body-change.js'
import { TURN_BUDGET } from '../../../../shared/turn-budget.js'
import { executionProfileFor, nativeToolsFor, supportsToolScoping, toolScopeFor } from '../../tool-scope.js'
import { roomToolsFor } from '../../gate/tool.js'
import { newWebhookToken, webhookPathOf } from '../../webhook.js'

// 房间本体的动作：改名、归档、删除、成员与身体。
export const createAdminActions = deps => {
  const {
    live, emit, roomFiles, files, memberAdd, memberRemove, stopRound, engine,
    readRoom, updateRoom, deleteRoom, store,
  } = deps

  const patchPolicy = async (room, policy, members = room.members ?? []) => {
    const failures = []
    const patched = []
    for (const member of members) {
      const ref = member.body?.ref
      if (typeof ref !== 'string' || ref === '') continue
      const selection = {
        instanceId: member.body?.engine ?? '',
        ...(typeof member.body?.model === 'string' && member.body.model !== '' ? { model: member.body.model } : {}),
      }
      let ok = true
      try {
        await engine.patchMemberBot(ref, {
          // 只改权限相关的字段：soul 是建房时按角色生成的，不能拿 spec 里的原文覆盖。
          description: member.station,
          approval: supportsToolScoping(member.body?.engine) ? approvalOf(policy) : 'ask',
          mcp: Array.isArray(member.body?.spec?.mcp) ? member.body.spec.mcp : [],
          roomTools: roomToolsFor(member),
          toolScope: toolScopeFor(member),
          nativeTools: nativeToolsFor(member),
          budget: TURN_BUDGET,
          profile: executionProfileFor(member, member.body?.engine),
          limits: { fileBytes: TURN_BUDGET.fileBytes, processes: TURN_BUDGET.processes },
          network: networkModeOf(policy),
          modelSelection: selection,
        })
      } catch (error) {
        ok = false
        failures.push(`${member.name}：${error?.message ?? error}`)
      }
      if (ok) patched.push(member)
    }
    return { failures, patched }
  }

  return {
    // 房间的三项权限：文件怎么改、网络用多少、外部动作问不问。
    // 改完立刻落到每个成员身上；有成员没落上就退回原策略，不留下半套。
    permissions: async ({ room: input, readBody }) => {
      const room = readRoom(input.id) ?? input
      const body = await readBody()
      const previous = roomPolicyOf(room)
      const { policy, error } = normalizeRoomPolicy(body.policy ?? body, previous)
      if (error !== undefined) return fail('invalid', error)
      if (typeof engine?.patchMemberBot !== 'function') return fail('conflict', '当前版本还不能调整权限')
      const blocked = bodyChangeBlocker(room, '调整权限')
      if (blocked !== null) return fail('conflict', blocked)
      if (policy.network === 'model') {
        let modes = []
        try {
          modes = (await engine.health?.())?.networkModes ?? []
        } catch {
          modes = []
        }
        // 基座给不出这一档就不让选，不把“只连模型”做成一句空话。
        if (!modes.includes('model')) return fail('conflict', '这个基座还不支持“只连模型”；先升级基座。')
        const unscoped = (room.members ?? []).filter(member => !supportsToolScoping(member.body?.engine))
        if (unscoped.length > 0) {
          return fail('conflict', `这间房里有成员的模型不支持“只连模型”：${unscoped.map(member => member.name).join('、')}。`)
        }
      }
      const { failures, patched } = await patchPolicy(room, policy)
      if (failures.length > 0) {
        // 已经落上的成员退回原策略；不影响本来就没改的。
        if (patched.length > 0) await patchPolicy(room, previous, patched)
        return fail('conflict', `有成员没更新：${failures.join('；')}`)
      }
      const updated = updateRoom(room.id, current => {
        current.policy = policy
        for (const member of current.members ?? []) {
          member.approval = supportsToolScoping(member.body?.engine) ? approvalOf(policy) : 'ask'
        }
        return { events: [{ type: 'room.policy', payload: policy }] }
      })
      if (updated === null) {
        if (patched.length > 0) await patchPolicy(room, previous, patched)
        return fail('not_found', '没有这个房间')
      }
      store.appendMessage(room.id, {
        kind: 'system',
        text: `这间房的权限调好了：${policySummaryOf(policy)}。`,
      })
      emit('room', store.readRoom(room.id) ?? updated)
      return ok({ room: store.readRoom(room.id) ?? updated })
    },

    rename: async ({ room, readBody }) => {
      const body = await readBody()
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (name === '' || Array.from(name).length > 60) return fail('invalid', '房间名不能为空，且不超过 60 字')
      const updated = updateRoom(room.id, current => {
        current.name = name
        return { events: [{ type: 'room.renamed', payload: { name } }] }
      })
      if (updated === null) {
        if (patched.length > 0) await patchPolicy(room, previous, patched)
        return fail('not_found', '没有这个房间')
      }
      emit('room', updated)
      return ok({ room: updated })
    },

    // 房间的 webhook 入口：开启幂等、轮换换新令牌、关闭直接删；路径只在开启时给。
    webhook: async ({ room: input, readBody }) => {
      const body = await readBody()
      const action = typeof body?.action === 'string' ? body.action : 'enable'
      if (!['enable', 'rotate', 'disable'].includes(action)) return fail('invalid', 'webhook 只有 enable / rotate / disable')
      if (action === 'disable') {
        if (input.webhook === undefined) return ok({ enabled: false, path: null })
        const cleared = updateRoom(input.id, current => {
          delete current.webhook
          return { events: [{ type: 'room.webhook', payload: { enabled: false } }] }
        })
        if (cleared === null) return fail('not_found', '没有这个房间')
        emit('room', cleared)
        return ok({ enabled: false, path: null })
      }
      const rotated = action === 'rotate' || typeof input.webhook?.token !== 'string' || input.webhook.token === ''
      const updated = updateRoom(input.id, current => {
        if (!rotated && current.webhook?.token) return null
        current.webhook = { token: newWebhookToken(), createdAt: Date.now() }
        return { events: [{ type: 'room.webhook', payload: { enabled: true, rotated } }] }
      })
      const room = updated ?? (readRoom(input.id) ?? input)
      if (updated !== null) emit('room', updated)
      return ok({ enabled: true, path: webhookPathOf(room) })
    },

    archive: async ({ room: input, readBody }) => {
      // 用最新快照判断有没有开着的轮次；界面上的旧快照会让归档漏掉正在跑的这一轮。
      let room = readRoom(input.id) ?? input
      const body = await readBody()
      if (body.archived === false) {
        const restored = updateRoom(room.id, current => {
          current.archivedAt = null
          // 归档会断开基座；取消归档要重新连上，否则房间看起来空闲，发消息却永远送不出去。
          current.live = current.demo === true ? false : true
          delete current.connectionError
          if (current.state === ROOM_STATE.stopped) {
            current.state = ROOM_STATE.idle
            current.idle = true
          }
          return { events: [{ type: 'room.restored' }] }
        })
        if (restored === null) return fail('not_found', '没有这个房间')
        if (restored.live === true && live.isAttached?.(restored.id) !== true) {
          try {
            await live.attach?.(restored)
          } catch (error) {
            log.warn(`room reattach failed after restore: ${restored.id} ${error?.message ?? error}`)
          }
        }
        emit('room', restored)
        return ok({ room: readRoom(room.id) ?? restored })
      }
      const wasLive = room.live === true && live.isAttached?.(room.id) === true
      const openRound = OPEN_ROUND_STATUSES.has(room.workRound?.status)
      const hadRound = typeof room.activeRoundId === 'string' && room.activeRoundId !== ''
      if (openRound) {
        const stopped = await stopRound({ store: deps.store, live, emit, room, reason: '房间已归档' })
        if (stopped.ok !== true) return stopped
        room = readRoom(room.id) ?? room
      } else if (wasLive) {
        await live.cancel?.({ roomId: room.id })
        live.detach?.(room.id)
      }
      const archivedAt = Date.now()
      const promiseBefore = room.promise
      const updated = updateRoom(room.id, current => {
        current.archivedAt = archivedAt
        current.live = false
        // 已经结束的轮次如果还挂着 activeRoundId，归档时一并清掉，房间不会卡在“归档了但删不掉”。
        current.activeRoundId = null
        // 归档即停：说好的事不会在归档期间继续排期；取消归档也不自动恢复。
        if (current.promise?.status === PROMISE_STATUS.active) {
          current.promise = {
            ...current.promise,
            status: PROMISE_STATUS.stopped,
            stoppedAt: archivedAt,
            stoppedReason: 'archived',
            updatedAt: archivedAt,
          }
        }
        if (openRound || hadRound || current.state === ROOM_STATE.active) {
          current.state = ROOM_STATE.stopped
          current.idle = false
        }
        return { events: [{ type: 'room.archived', payload: { stopped: openRound || hadRound } }] }
      })
      if (updated === null) {
        if (patched.length > 0) await patchPolicy(room, previous, patched)
        return fail('not_found', '没有这个房间')
      }
      disarmPromise({ store: deps.store ?? {}, roomId: room.id, promise: promiseBefore })
      emit('room', updated)
      return ok({ room: updated })
    },

    delete: async ({ room }) => {
      // 只有正在跑的房要先停下再删；聊完了、交付了、停住了都能直接删，归档不是删除的前提。
      if (!roomDeletableNow(room)) return fail('conflict', '房间正在跑；先停下再删除')
      disarmPromise({ store: deps.store ?? {}, roomId: room.id, promise: room.promise })
      if (room.live === true && live.isAttached?.(room.id) === true) live.detach?.(room.id)
      // 删房时把成员身体和隐藏 Bot 一起退役；工作区和用户文件留着。
      // 基座没清干净就保留房间并报错：宁可删不掉，也不留下孤儿成员。
      try {
        await live.retireRoomBots?.(room)
      } catch (error) {
        log.warn(`room bots retire failed: ${room.id} ${error?.message ?? error}`)
        return fail('conflict', '基座没能清理这个房间的成员；房间还在，等连接恢复后再删。')
      }
      const removed = typeof deleteRoom === 'function' ? deleteRoom(room.id) : false
      if (removed !== true) return fail('not_found', '没有这个房间')
      // 只删房间自己的 .crew/rooms/<id> 过程档案；交付工作区和用户仓库不碰。
      const roomRoot = roomFiles.roomDir?.(room)
      if (typeof roomRoot === 'string' && roomRoot !== '') {
        try { files.remove(roomRoot) } catch (error) {
          log.warn(`room files remove failed: ${room.id} ${error?.message ?? error}`)
        }
      }
      emit('room.deleted', { id: room.id, name: room.name })
      return ok({ id: room.id })
    },

    // 添加成员与换身体允许在暂停时进行（例如模型登录失效后补人），不受暂停门禁限制。
    'add-member': async ({ room, readBody }) => {
      if (room.live !== true) return fail('conflict', '房间没有连上，不能加成员')
      // 工作室的成员由规划师组队；用户只能在成员出故障时换模型。
      if (room.roomType === 'studio') return fail('forbidden', '工作室成员由规划师决定，不能手动添加')
      return memberAdd.add(room, await readBody())
    },

    'remove-member': async ({ room, readBody }) => {
      if (room.roomType === 'studio') return fail('forbidden', '工作室成员由规划师决定，不能手动移除')
      return memberRemove.remove(room, await readBody())
    },

    'swap-body': async ({ room, readBody }) => {
      if (room.live !== true || typeof live.swapBody !== 'function') return fail('conflict', '当前房间不能调整成员')
      const body = await readBody()
      // 人是修故障，不是改编制：工作室只允许换 engine/model。
      return live.swapBody(room, room.roomType === 'studio'
        ? { memberId: body?.memberId, engine: body?.engine, model: body?.model }
        : body)
    },
  }
}
