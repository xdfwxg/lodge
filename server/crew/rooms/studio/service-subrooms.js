import { canCreateSubroom, MAX_SUBROOM_DEPTH } from './subrooms.js'
import { fail } from '../../result.js'
import { createAssignment } from '../../assignments.js'
import { leadMemberOf } from '../../room-members.js'

const activeStageIndexOf = parent => {
  const stages = Array.isArray(parent?.stages) ? parent.stages : []
  const active = stages.findIndex(stage => stage.state === 'active')
  return active >= 0 ? active : Math.max(0, stages.length - 1)
}

// 子房间交接属于工作室：通用建房只负责父子房间关系，这里才写父房的房间级 Assignment。
export const createServiceSubrooms = ({ createRoom, store, emit = () => {} }) => ({
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
    const child = result?.body?.room ?? null
    if (result?.ok === false || child === null) return result
    const stageIndex = activeStageIndexOf(parent)
    const assignment = createAssignment({
      store,
      roomId: parent.id,
      stageIndex,
      fromMemberId: parent.leadMemberId ?? leadMemberOf(parent)?.id ?? null,
      toMemberId: null,
      reason: 'subroom',
      brief: {
        stageTitle: child.name ?? goal,
        kind: 'subroom',
        goal,
        done: [],
        constraints: [],
        acceptance: typeof body.acceptance === 'string' ? body.acceptance : '',
        prompt: '',
      },
      context: {
        childRoomId: child.id,
        childName: child.name ?? goal,
        childLeadMemberId: child.leadMemberId ?? null,
        depth: child.depth ?? null,
      },
      status: 'sent',
    })
    const linked = store.updateRoom(child.id, current => {
      current.parentAssignmentId = assignment.id
      return { events: [] }
    })
    if (linked !== null) result.body.room = linked
    store.appendEvent(parent.id, 'assignment.created', {
      assignmentId: assignment.id,
      stage: stageIndex,
      from: parent.leadMemberId ?? leadMemberOf(parent)?.id ?? null,
      to: null,
      reason: 'subroom',
      childRoomId: child.id,
    })
    const parentRoom = store.readRoom(parent.id)
    if (parentRoom !== null) emit('room', parentRoom)
    return result
  },
})
