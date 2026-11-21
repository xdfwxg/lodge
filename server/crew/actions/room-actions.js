import { fail } from '../result.js'
import { createLodgeActions } from './room/lodge.js'
import { createRunActions } from './room/run.js'
import { createAdminActions } from './room/admin.js'
import { createRoundActions } from './room/round.js'
import { ROOM_STATE } from '../../../shared/states.js'

// 一轮工作被暂停/停止拦住；房间自身的动作和运行中动作不受这条门禁影响。
const ROUND_ACTIONS = new Set([
  'rounds', 'messages', 'human-choice', 'accept', 'chat-continue', 'chat-resume',
  'reject-plan', 'stop-round', 'fail-round', 'supersede-round', 'resolve-merge',
  'rework', 'retry', 'rewind',
])

// 房间 HTTP 动作只按名字分派；每个动作的规则在 room/<family>.js 里。
export const createRoomActions = (ctx) => {
  const { readRoom } = ctx.store
  const deps = { ...ctx, ...ctx.store }
  const actions = {
    ...createLodgeActions(deps),
    ...createRunActions(deps),
    ...createAdminActions(deps),
    ...createRoundActions(deps),
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
