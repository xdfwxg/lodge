import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { skillPrompt, stageGuidance } from '../../prompt-modes.js'
import { buildSeatHandoff } from './seat-handoff.js'
import { seatDisplayName } from '../../seat-labels.js'

// 工作室引擎：所有推进都走群聊。Lodge 把阶段交接直接发给执行者，执行者回合
// 结束后跑验收、写证据，再 @ 验收员。这里不直接写席位线程。
export const createStudioEngine = ({ engine }) => ({
  owns: room => room?.roomType === 'studio',
  send: async (room, text) => {
    if (room?.chatRoom === undefined) throw new Error('工作室没有群聊总线')
    return engine.sendTurn({ roomId: room.chatRoom.id, text })
  },
})

// 执行席位的阶段交接包：由代码装配，规划师只决定交给谁，不转述事实。
export const studioWorkerPrompt = ({
  room,
  messages,
  stage,
  index,
  assignee,
  rework = false,
  note = '',
  acceptance = '',
  readOnly = false,
  seatSkills = [],
  workspace = {},
  port,
  environment,
}) => {
  const workerHandle = room.seatNames?.[assignee] ?? seatDisplayName(room, assignee)
  return [
    `@${workerHandle} 阶段 ${index + 1}「${stage.title}」已确认。${acceptance}`,
    rework
      ? `用户说上一轮结果不对：${note === '' ? '没有补充说明，请重新对照目标。' : note}。先重读目标、done 和约束；如果目标理解有误，先在回复里指出并停止；否则按新要求返工。`
      : '',
    ...stageGuidance({ readOnly }),
    ...skillPrompt(seatSkills),
    buildSeatHandoff({ room, messages }),
    workspace.multi === true
      ? workspace.isolation === 'worktree'
        ? '你在自己的 worktree 里与其他执行席位并行工作；只改自己的 worktree，系统会把候选分支合并到房间分支。'
        : '你在自己的隔离副本里与其他执行席位并行工作；只改自己的副本，系统会按文件合并到房间目录。'
      : '在当前工作目录完成。',
    port === undefined ? '' : `如需起本地服务，用 PORT=${port}。`,
    environment?.linked?.includes('node_modules')
      ? 'node_modules 已软链为只读依赖，不要修改它。'
      : '',
    workspace.candidate === true ? '系统会提交候选。' : '不要改房间记录。',
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}
