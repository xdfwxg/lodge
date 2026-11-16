import { canCreateSubroom, MAX_SUBROOM_DEPTH } from './subrooms.js'
import { fail } from '../../result.js'

// 子房间只能是工作室，且父 Planner 只消费子 Verifier 的 verdict。
export const createServiceSubrooms = ({ createRoom }) => ({
  create: async (parent, body = {}) => {
    if (!canCreateSubroom(parent)) {
      return fail('conflict', `工作室最多嵌套 ${MAX_SUBROOM_DEPTH} 层，或当前房间不能创建子房间`)
    }
    const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
    if (goal === '') return fail('invalid', '子房间需要目标')
    const result = await createRoom({
      ...body,
      goal,
      roomType: 'studio',
      // 子房间只给目标时按人工签字走；要跑命令验收必须显式带上 verify 和 acceptance。
      verify: body.verify === 'test' ? 'test' : 'manual',
      parentRoomId: undefined,
      depth: undefined,
    }, parent)
    return result
  },
})
