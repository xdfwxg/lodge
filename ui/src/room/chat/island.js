// 聊天室也走同一个目标岛；它没有工作室阶段，用讨论和结论两步表达进度。
const STATUS = { paused: 'paused', stopped: 'stopped' }

export const chatIslandGoal = room => {
  const chat = room.chat ?? {}
  const accepted = chat.phase === 'accepted'
  const concluded = accepted || chat.phase === 'concluded' || chat.phase === 'awaiting_decision'
  return {
    id: room.id,
    title: room.name,
    status: STATUS[room.state] ?? 'active',
    idle: room.idle === true || room.needsYou?.kind === 'idle',
    current: concluded ? 1 : 0,
    stages: [
      { title: '讨论', kind: 'decision', status: concluded ? 'passed' : 'active' },
      { title: '结论', kind: 'decision', status: accepted ? 'passed' : concluded ? 'active' : 'pending' },
    ],
    objective: room.brief?.objective || room.goal,
  }
}
