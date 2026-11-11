import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { roomNeedsYou } from './attention.js'
import { simulateRoom } from './demo.js'
import { createDispatchService } from './dispatch-service.js'
import { createRealRoom } from './room-create.js'
import { recommendRoster as recommendRosterUseCase } from './roster-recommend.js'
import { TEMPLATE_LIST } from './seats.js'
import { gateFor } from './gates.js'
import { repoRootOf } from './paths.js'
import { accepted, created, fail, ok } from './result.js'
import {
  commitRoom,
  gitAvailable,
  readBrief,
  roomDir,
  writeConclusion,
  writeGoal,
} from './room-repo.js'

// 业务层：只见 store / live / 事件出口，不碰 HTTP，也不碰基座字段。
export const createCrewService = ({ store, engine, live, emit, dispatchPayload, seats }) => {
  const { readRoom, readRooms, readMessages, readMessagesSince, writeRoom, updateRoom, appendMessage, appendEvent } = store
  const dispatch = createDispatchService({ store, emit, dispatchPayload })

  const health = async () => ok({ runtime: await engine.health() })

  const state = () => ({
    seats,
    templates: TEMPLATE_LIST,
    rooms: readRooms().map(room => {
      const messages = readMessages(room.id)
      return { ...room, brief: readBrief(room), messages, needsYou: roomNeedsYou(room, messages) }
    }),
    dispatch: dispatchPayload(),
  })

  const messagesSince = since => readMessagesSince(since)

  const evidence = (roomId, messageId) => {
    const room = readRoom(roomId)
    if (room === null) return fail('not_found', '没有这个房间')
    const file = join(roomDir(room), 'evidence', `${messageId}.json`)
    if (!existsSync(file)) return fail('not_found', '没有这份证据')
    return { ok: true, bytes: readFileSync(file) }
  }

  const createRoom = body => createRealRoom({ store, engine, live, emit, seats, dispatchPayload, body })
  const recommendRoster = body => recommendRosterUseCase({ engine, body })

  const control = async (room, action) => {
    if (action === 'pause' && room.state !== 'active') return fail('conflict', '只有进行中的房间能暂停')
    if (action === 'resume' && room.state !== 'paused') return fail('conflict', '这个房间没有暂停')
    if (action === 'stop' && room.state !== 'active' && room.state !== 'paused') {
      return fail('conflict', '这个房间已经结束')
    }
    const expected = room.state
    const nextState = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'stopped'
    const updated = updateRoom(room.id, current => {
      if (current.state !== expected) return null
      current.state = nextState
      current.idle = false
      if (nextState === 'active') current.noProgress = 0
      return { events: [{ type: 'room.state', payload: { state: nextState, action } }] }
    })
    if (updated === null) return fail('conflict', '房间状态已变化，重试')
    room = updated
    if (!room.demo) writeGoal(room)
    emit('room', room)
    emit('dispatch', dispatchPayload())

    const liveRoom = room.live === true
    let cancelled = false
    // 引擎能取消就真取消；不能取消时文案如实说明，不假装停下了。
    if (liveRoom && action !== 'resume') {
      try {
        cancelled = (await live.cancel({ roomId: room.id })).cancelled === true
      } catch {
        cancelled = false
      }
    }
    const note = action === 'pause'
      ? liveRoom
        ? cancelled
          ? '已暂停 · 基座里的回合已取消；已落盘的阶段与证据保留'
          : '已暂停 · 你的消息不再转发给基座；基座里正在跑的回合无法从这里中断'
        : '已暂停 · 阶段与证据保留，继续时从当前阶段接着走'
      : action === 'resume'
        ? '已继续 · 从当前阶段接着走'
        : liveRoom
          ? cancelled
            ? '已停止 · 基座里的回合已取消；已落盘的阶段与证据保留'
            : '已停止 · 你的消息不再转发给基座；已落盘的阶段与证据保留'
          : '已停止 · 已通过的阶段与证据保留，不会再派新活'
    appendMessage(room.id, { kind: 'system', text: note })
    return ok({ room })
  }

  const completeRoom = room => {
    appendMessage(room.id, {
      kind: 'conclusion',
      authorId: 'planner',
      text: `目标达成：${room.goal}`,
      meta: {
        stages: room.stages.length,
        commands: room.stages.map(item => item.acceptance).filter(Boolean),
      },
    })
    appendEvent(room.id, 'room.conclusion', {
      stages: room.stages.length,
      commands: room.stages.map(item => item.acceptance).filter(Boolean),
    })
    if (room.demo === true) {
      appendMessage(room.id, { kind: 'system', text: '演示房间 · 不写 CONCLUSION.md，不产生 commit' })
      return
    }
    writeConclusion(room)
    if (!gitAvailable) {
      appendEvent(room.id, 'room.commit', { status: 'unavailable' })
      appendMessage(room.id, { kind: 'system', text: '已写入 CONCLUSION.md · 本机 git 不可用，未产生 commit' })
      return
    }
    const delivered = readMessages(room.id).flatMap(message => [
      ...(message.meta?.artifacts ?? []).map(artifact => artifact.path).filter(Boolean),
      ...(message.meta?.changedFiles ?? []).map(file => join(repoRootOf(room), file)),
    ])
    // 先落这条完成记录，再提交，避免提交后 transcript 又变脏。
    appendMessage(room.id, { kind: 'system', text: '已写入 CONCLUSION.md · 本地 commit 一次 · 未 push' })
    const committed = commitRoom(room, delivered)
    appendEvent(room.id, 'room.commit', { status: committed ? 'done' : 'failed' })
    if (!committed) {
      appendMessage(room.id, { kind: 'system', text: 'commit 失败，详见服务端日志' })
    }
  }

  const accept = (room, body) => {
    const index = Number(body.stage)
    let gate = null
    let next = -1
    const updated = updateRoom(room.id, current => {
      gate = gateFor(current, index, readMessages(room.id))
      if (!gate.ok) return null
      const stage = current.stages[index]
      stage.state = 'passed'
      next = current.stages.findIndex(item => item.state === 'pending')
      if (next >= 0) current.stages[next].state = 'active'
      else current.state = 'complete'
      return {
        events: [
          { type: 'stage.passed', payload: { stage: index, kind: stage.kind, by: 'you' } },
          ...(next < 0 ? [{ type: 'room.complete', payload: {} }] : []),
        ],
      }
    })
    if (gate !== null && gate.ok === false) return fail(gate.reason, gate.error)
    if (updated === null) return fail('not_found', '没有这个房间')
    room = updated
    if (!room.demo) writeGoal(room)
    emit('room', room)
    emit('dispatch', dispatchPayload())
    appendMessage(room.id, {
      kind: 'system',
      text: gate.stage.kind === 'deliverable'
        ? `阶段 ${index + 1} 已按证据验收`
        : `阶段 ${index + 1} 已由你确认`,
      meta: { kind: 'gate', gate: gate.stage.kind, stage: index, by: 'you' },
    })
    if (next < 0) completeRoom(room)
    else if (room.live === true && room.stages[next]?.kind === 'deliverable' && typeof live.startStage === 'function') {
      void live.startStage(room, next).catch(error => {
        appendMessage(room.id, { kind: 'system', text: `启动执行失败：${error?.message ?? error}` })
      })
    }
    return ok({ room })
  }

  const setAcceptance = (room, index, command) => {
    let rejection = null
    const updated = updateRoom(room.id, current => {
      const stage = current.stages[index]
      if (stage === undefined) { rejection = ['invalid', '没有这个阶段']; return null }
      if (stage.kind !== 'deliverable') { rejection = ['invalid', '只有交付型阶段能设置验收命令']; return null }
      if (stage.state === 'passed') { rejection = ['conflict', '这个阶段已经过了']; return null }
      const trimmed = command.trim()
      if (trimmed.length > 500) { rejection = ['invalid', '验收命令不超过 500 字']; return null }
      if (trimmed === '') delete stage.acceptance
      else stage.acceptance = trimmed
      return { events: [{ type: 'stage.acceptance', payload: { stage: index, command: stage.acceptance ?? '' } }] }
    })
    if (rejection !== null) return fail(rejection[0], rejection[1])
    if (updated === null) return fail('not_found', '没有这个房间')
    room = updated
    if (!room.demo) writeGoal(room)
    emit('room', room)
    const trimmed = command.trim()
    const message = appendMessage(room.id, {
      kind: 'system',
      text: trimmed === ''
        ? `阶段 ${index + 1} 的验收命令已清空`
        : `阶段 ${index + 1} 的验收命令：\`${trimmed}\``,
    })
    return ok({ room, message })
  }

  const roomRequest = async (roomId, action, { method, readBody = async () => ({}) }) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')

    if ((action === 'pause' || action === 'resume' || action === 'stop') && method === 'POST') {
      return control(room, action)
    }

    if (action === 'acceptance' && method === 'POST') {
      const body = await readBody()
      return setAcceptance(room, Number(body.stage), typeof body.command === 'string' ? body.command : '')
    }

    if (action === 'verify' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '只有实时房间能用引擎复核；演示房间请用模拟执行')
      if (live.isAttached(room.id) !== true) return fail('conflict', '这个旧版实时房间不再绑定；请新建一个真实房间')
      const body = await readBody()
      try {
        return accepted(await live.requestReview(room.id, Number(body.stage)))
      } catch (error) {
        return fail('conflict', String(error?.message ?? error))
      }
    }

    if (room.state === 'paused' || room.state === 'stopped') {
      return fail('conflict', room.state === 'paused' ? '房间已暂停' : '房间已停止')
    }

    if (action === 'messages' && method === 'POST') {
      const body = await readBody()
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (text === '' || text.length > 8000) return fail('invalid', '消息不能为空，且不超过 8000 字')
      if (room.live === true) {
        if (live.isAttached(room.id) !== true) return fail('conflict', '这个旧版实时房间不再绑定；请新建一个真实房间')
        if (live.busyReview(room.id)) return fail('conflict', '复核进行中，先等验收结论')
        await live.send(room.id, text)
        return accepted({ accepted: true })
      }
      const message = appendMessage(roomId, { kind: 'chat', authorId: 'you', text })
      const active = room.stages.find(stage => stage.state === 'active')
      if (room.openQuestion !== null && active?.kind === 'decision') {
        room.openQuestion = null
        writeRoom(room)
        emit('room', room)
        emit('dispatch', dispatchPayload())
      }
      return created({ message })
    }

    if (action === 'accept' && method === 'POST') {
      return accept(room, await readBody())
    }

    if (action === 'simulate' && method === 'POST') {
      return simulateRoom({ readMessages, appendMessage, room })
    }

    return fail('method', '方法不对')
  }

  return {
    state,
    health,
    messagesSince,
    evidence,
    createRoom,
    recommendRoster,
    roomRequest,
    dispatchRequest: dispatch.request,
  }
}
