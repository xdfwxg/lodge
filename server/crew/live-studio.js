import { INTERNAL_PROMPT_MARKER } from './internal-prompts.js'
import { buildSeatHandoff } from './seat-handoff.js'
import { plannerToolPrompt } from './planner-tools.js'
import { seatDisplayName } from './seat-labels.js'
import { workContract } from './prompt-modes.js'

// 工作室引擎：所有推进都走群聊。规划师被 @ 后交给执行者，执行者回合结束后
// Lodge 跑验收、写证据，再 @ 验收员。这里不直接写席位线程。
export const createStudioEngine = ({ engine }) => ({
  owns: room => room?.roomType === 'studio',
  send: async (room, text) => {
    if (room?.chatRoom === undefined) throw new Error('工作室没有群聊总线')
    return engine.sendTurn({ roomId: room.chatRoom.id, text })
  },
})

export const studioPlannerPrompt = ({
  room,
  messages,
  stage,
  index,
  assignee,
  rework = false,
  note = '',
  acceptance = '',
}) => {
  const lead = room.leadSeat ?? room.members?.[0]
  const leadHandle = room.seatNames?.[lead] ?? seatDisplayName(room, lead)
  const workerHandle = room.seatNames?.[assignee] ?? seatDisplayName(room, assignee)
  return [
    `@${leadHandle} 阶段 ${index + 1}「${stage.title}」已确认。请把这个阶段交给 @${workerHandle}。`,
    rework
      ? `用户说上一轮结果不对：${note === '' ? '没有补充说明，请重新对照目标。' : note}`
      : '',
    ...workContract('lead'),
    buildSeatHandoff({ room, messages }),
    ...(Array.isArray(room.gate?.advice) && room.gate.advice.length > 0
      ? [`Gate/评估建议（仅参考，不替代你的判断）：${room.gate.advice.map(item => item.summary ?? [...(item.reasons ?? []), ...(item.risks ?? [])].join('；')).filter(Boolean).join('；')}`]
      : []),
    `阶段目标：${stage.title}`,
    acceptance,
    `工作目录：${room.repoPath ?? '(未设置)'}`,
    ...plannerToolPrompt({ mcp: typeof room.plannerTools?.server === 'string' }),
    `你只做目标对齐和交接，不写代码。请回复一条 @${workerHandle} 的派活消息，说明阶段目标、验收命令和用户约束；不要自己执行。回复时使用 @${workerHandle} 这个 handle。`,
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}
