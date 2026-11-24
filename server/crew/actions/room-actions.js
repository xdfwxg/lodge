import { fail } from '../result.js'
import { createLodgeActions } from './room/lodge.js'
import { createRunActions } from './room/run.js'
import { createAdminActions } from './room/admin.js'
import { createRoundActions } from './room/round.js'
import { createPromiseActions } from '../promise/actions.js'
import { createStudioMessageHandler } from '../rooms/studio/facade.js'
import { ROOM_STATE } from '../../../shared/states.js'

// 一轮工作被暂停/停止拦住；房间自身的动作和运行中动作不受这条门禁影响。
const ROUND_ACTIONS = new Set([
  'rounds', 'messages', 'human-choice', 'decision', 'accept', 'chat-continue', 'chat-resume',
  'reject-plan', 'stop-round', 'fail-round', 'supersede-round', 'resolve-merge',
  'rework', 'retry', 'rewind',
])

// 房间 HTTP 动作只按名字分派；每个动作的规则在 room/<family>.js 里。
export const createRoomActions = (ctx) => {
  const { readRoom } = ctx.store
  // 房型认领用户消息；通用动作只按 id 分派，不认识任何房型策略。
  const messageHandlers = {
    ...(typeof ctx.chat?.handleMessage === 'function'
      ? { chat: (room, input) => ctx.chat.handleMessage(room, input) }
      : {}),
    ...(ctx.stages === undefined || typeof ctx.humanHandoffStageOf !== 'function'
      ? {}
      : {
        studio: createStudioMessageHandler({
          stages: ctx.stages,
          readRoom,
          readMessages: ctx.store.readMessages,
          humanHandoffStageOf: ctx.humanHandoffStageOf,
        }),
      }),
  }
  const deps = { ...ctx, ...ctx.store, messageHandlers }
  const actions = {
    ...createLodgeActions(deps),
    ...createRunActions(deps),
    ...createAdminActions(deps),
    ...createRoundActions(deps),
    ...createPromiseActions(deps),
  }

  const roomRequest = async (roomId, action, { method, readBody = async () => ({}) }) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    const handler = actions[action]
    if (handler === undefined || method !== 'POST') return fail('method', '方法不对')
    if (ROUND_ACTIONS.has(action) && (room.state === ROOM_STATE.paused || room.state === ROOM_STATE.stopped)) {
      return fail('conflict', room.state === ROOM_STATE.paused ? '房间已暂停' : '房间已停止')
    }
    return handler({ roomId, room, readBody })
  }

  return { roomRequest }
}
