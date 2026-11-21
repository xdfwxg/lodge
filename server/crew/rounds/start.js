import { fail, ok } from '../result.js'
import { normalizePlan, startInitialStage, studioConstraints } from '../rooms/studio/facade.js'
import { buildStages } from '../room-types/studio.js'
import { gateRecordOf } from '../gate/index.js'
import { buildRound, composeRoundView } from './record.js'

const isWorker = member => member.role === 'worker' || member.roleKind === 'executor'
const workerOf = room => (room.members ?? []).find(isWorker) ?? null
const verifiersOf = room => (room.members ?? []).filter(member => member.role === 'verifier' || member.roleKind === 'verifier')

export const startRound = async ({ store, live, emit, room, body, roomFiles }) => {
  if (room === null || room.roomType !== 'studio') return fail('invalid', '只有工作室能开一轮')
  if (room.state === 'paused' || room.state === 'stopped') return fail('conflict', '先让工作室继续，再开新一轮')
  if (typeof room.activeRoundId === 'string' && room.activeRoundId !== '') {
    return fail('conflict', '这一轮还没结束；先停下或作废这一轮')
  }
  const goal = typeof body?.goal === 'string' ? body.goal.trim() : ''
  if (goal === '' || goal.length > 2000) return fail('invalid', '目标不能为空，且不超过 2000 字')
  const verify = body?.verify === 'test' ? 'test' : 'manual'
  const acceptance = typeof body?.acceptance === 'string' ? body.acceptance.trim() : ''
  if (verify === 'test' && acceptance === '') return fail('invalid', '要交付的这一轮需要一条检查')
  const planned = normalizePlan({ body: { ...body, roomType: 'studio' } })
  if (planned.error !== undefined) return fail('invalid', planned.error)

  const lead = (room.members ?? []).find(member => member.role === 'lead' || member.roleKind === 'planner') ?? null
  const worker = workerOf(room)
  if (lead === null || worker === null) return fail('invalid', '工作室缺少规划师或执行官')

  const title = goal.length > 24 ? `${goal.slice(0, 24)}…` : goal
  const built = buildStages({ title, plan: planned.plan, verify, acceptance, align: false })
  const gate = gateRecordOf({
    review: { decision: 'pass', issues: [] },
    humanReviewed: false,
    check: { mode: verify, acceptance },
  })
  const round = buildRound({
    room,
    goal,
    name: title,
    projectId: typeof body?.projectId === 'string' && body.projectId !== '' ? body.projectId : (room.defaultProjectId ?? null),
    ordinal: store.nextWorkRoundOrdinal(room.id),
    plan: planned.plan,
    stages: built.stages,
    gate,
    closure: planned.plan === null ? 'open' : 'planned',
    shadowReview: body?.shadowReview === true,
    orchestration: room.orchestration ?? null,
    constraints: studioConstraints({
      plan: planned.plan,
      verify,
      acceptance,
      verifiers: verifiersOf(room),
      independence: room.independence,
    }),
    decisions: Array.isArray(body?.decisions)
      ? body.decisions
      : Array.isArray(body?.plan?.answers)
        ? body.plan.answers.map(answer => ({
          question: answer.question,
          chosen: answer.answer,
          at: Date.now(),
        }))
        : [],
    origin: {
      sourceRoomId: typeof body?.sourceRoomId === 'string' ? body.sourceRoomId : room.sourceRoomId ?? null,
      sourceName: typeof body?.sourceName === 'string' ? body.sourceName : room.sourceName ?? null,
      continuation: body?.continuation ?? null,
    },
  })

  store.writeWorkRound(round)
  const updated = store.updateRoom(room.id, current => {
    current.state = 'active'
    current.activeRoundId = round.id
    current.idle = false
    current.noProgress = 0
    current.pauseReason = null
    return { events: [{ type: 'round.started', payload: { roundId: round.id, ordinal: round.ordinal } }] }
  })
  if (updated === null) return fail('not_found', '工作室不存在')

  const view = composeRoundView(updated, round)
  store.appendMessage(room.id, { kind: 'system', text: `第 ${round.ordinal} 轮开始：${goal}` })
  for (const message of built.messages ?? []) {
    store.appendMessage(room.id, { kind: 'system', text: message })
  }
  roomFiles.writeGoal(view)
  emit?.('room', store.readRoom(room.id) ?? view)

  if (room.live === true) {
    try {
      live.detach?.(room.id)
      await live.attach(view, { resume: false })
    } catch (error) {
      store.appendMessage(room.id, {
        kind: 'system',
        text: `新一轮没能重新连上成员：${error?.message ?? error}`,
      })
    }
  }
  const started = await startInitialStage({
    store,
    live,
    room: view,
    plan: planned.plan,
    align: false,
    workers: [worker, ...(room.members ?? []).filter(member => member !== worker && isWorker(member))],
    lead,
    worker,
    roster: room.members ?? [],
    goal,
    verify,
    acceptance,
    emit,
  })
  return ok({ room: store.readRoom(room.id) ?? started, round })
}
