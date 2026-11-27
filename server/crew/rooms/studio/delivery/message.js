import { accepted } from '../../../result.js'

// 规划师把这一步交给人时，人的下一句话就是补充上下文，直接重跑这一步。
// 没有交给人就返回 null，让通用动作按普通消息送到基座。
export const createStudioMessageHandler = ({ stages, readRoom, readMessages, humanHandoffStageOf }) => async (room, { text = '' } = {}) => {
  const stage = humanHandoffStageOf(room, readMessages(room.id))
  if (stage === null) return null
  const result = await stages.rework(room, { stage, note: text })
  if (result.ok !== true) return result
  return accepted({ room: result.body?.room ?? readRoom(room.id) })
}
