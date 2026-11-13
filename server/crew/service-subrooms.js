import { canCreateSubroom, MAX_SUBROOM_DEPTH } from './room-subrooms.js'
import { fail } from './result.js'

// 子工作室只能是 studio，且父 Planner 只消费子 Verifier 的 verdict。
export const createServiceSubrooms = ({ createRoom }) => ({
  create: async (parent, body = {}) => {
    if (!canCreateSubroom(parent)) {
      return fail('conflict', `工作室最多嵌套 ${MAX_SUBROOM_DEPTH} 层，或当前房间不能创建子工作室`)
    }
    const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
    if (goal === '') return fail('invalid', '子工作室需要目标')
    const result = await createRoom({
      ...body,
      goal,
      roomType: 'studio',
      parentRoomId: undefined,
      depth: undefined,
    }, parent)
    return result
  },
})
