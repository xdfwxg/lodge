import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { stageGuidance } from '../../prompt-modes.js'
import { buildMemberHandoff } from './member-handoff.js'

// 执行成员的阶段交接包：由代码装配，规划师只决定交给谁，不转述事实。
export const studioWorkerPrompt = ({
  room,
  messages,
  stage,
  index,
  rework = false,
  note = '',
  acceptance = '',
  readOnly = false,
  workspace = {},
  port,
  environment,
}) => {
  return [
    `阶段 ${index + 1}「${stage.title}」已确认。${acceptance}`,
    rework
      ? `用户说上一轮结果不对：${note === '' ? '没有补充说明，请重新对照目标。' : note}。先重读目标、done 和约束；如果目标理解有误，先在回复里指出并停止；否则按新要求重做。`
      : '',
    ...stageGuidance({ readOnly }),
    buildMemberHandoff({ room, messages }),
    workspace.parallel === true
      ? workspace.isolation === 'worktree'
        ? '你在自己的 worktree 里与其他执行成员并行工作；只改自己的 worktree，系统会把候选分支合并到房间分支。'
        : '你在自己的隔离副本里与其他执行成员并行工作；只改自己的副本，系统会按文件合并到房间目录。'
      : '在当前工作文件夹完成。',
    port === undefined ? '' : `如需起本地服务，用 PORT=${port}。`,
    environment?.linked?.includes('node_modules')
      ? 'node_modules 已软链为只读依赖，不要修改它。'
      : '',
    workspace.candidate === true ? '系统会提交候选。' : '不要改房间记录。',
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}
