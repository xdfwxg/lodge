import { stripAttachmentTags } from '../../../../shared/attachments.js'
import { islandStatusOf } from '../../goal-island/status.js'

// 聊天室不是“目标 + 结论”的任务。岛只讲一件事：现在在聊，还是聊到这儿了。
export const chatIslandGoal = room => {
  const chat = room.chat ?? {}
  const accepted = chat.phase === 'accepted'
  const status = islandStatusOf(room, 'chat')
  return {
    id: room.id,
    kind: 'chat',
    title: room.name,
    status: status.key === 'done' ? 'complete'
      : status.key === 'paused' ? 'paused'
        : status.key === 'stopped' ? 'stopped' : 'active',
    // 聊天室没有“等你处理”；想聊就聊，不想聊就放着。
    idle: false,
    barLabel: status.barLabel,
    tone: status.tone,
    stageLabel: status.stageLabel,
    current: 0,
    // 只有用户认可后才算“已确认”；聊到这儿只是状态，不让岛以为任务完成了。
    stages: [{ title: '聊天', kind: 'decision', status: accepted ? 'passed' : 'active' }],
    objective: room.brief?.objective || stripAttachmentTags(room.goal),
  }
}
