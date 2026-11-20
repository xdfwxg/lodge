import { stripAttachmentTags } from '../../../../shared/attachments.js'

// 聊天室不是“目标 + 结论”的任务。岛只讲一件事：现在在聊，还是聊到这儿了。
const STATUS = { paused: 'paused', stopped: 'stopped' }

export const chatIslandGoal = room => {
  const chat = room.chat ?? {}
  const accepted = chat.phase === 'accepted'
  const concluded = accepted || chat.phase === 'concluded' || chat.phase === 'awaiting_decision'
  const summarizing = chat.phase === 'summarizing'
  const paused = room.state === 'paused' || room.state === 'stopped'
  return {
    id: room.id,
    kind: 'chat',
    title: room.name,
    status: STATUS[room.state] ?? (accepted ? 'complete' : 'active'),
    // 聊天室没有“等你处理”；想聊就聊，不想聊就放着。
    idle: false,
    barLabel: paused
      ? '已暂停，随时接着聊'
      : accepted
        ? '聊完了'
        : summarizing
          ? '正在收一下'
          : concluded ? '聊到这儿了' : '正在聊',
    current: 0,
    // 只有用户认可后才算“已确认”；聊到这儿只是状态，不让岛以为任务完成了。
    stages: [{ title: '聊天', kind: 'decision', status: accepted ? 'passed' : 'active' }],
    objective: room.brief?.objective || stripAttachmentTags(room.goal),
  }
}
