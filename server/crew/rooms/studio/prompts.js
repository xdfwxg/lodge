import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { stageGuidance } from '../../prompt-modes.js'
import { buildMemberHandoff } from './member-handoff.js'
import { sanitizeUntrusted } from '../../../../shared/untrusted-text.js'
import { humanLabelOf } from '../../human-name.js'

// 执行官的阶段交接包：由代码装配，规划师只决定交给谁，不转述事实。
export const studioWorkerPrompt = ({
  room,
  messages,
  memberId = '',
  stage,
  workPackage = null,
  index,
  rework = false,
  note = '',
  readOnly = false,
  workspace = {},
  port,
  environment,
}) => {
  const contract = room.plan?.contract ?? null
  const clauseIds = Array.isArray(stage.clauseIds) ? stage.clauseIds : []
  const clauses = contract === null
    ? []
    : contract.outcomes.filter(outcome => clauseIds.length === 0 || clauseIds.includes(outcome.id))
  return [
    `阶段 ${index + 1}「${sanitizeUntrusted(stage.title, 120)}」。这一步要交付：${sanitizeUntrusted(stage.deliverable ?? room.goal ?? '', 500)}`,
    ...(clauses.length === 0
      ? []
      : [
        '这一步要对上的契约：',
        ...clauses.map(outcome => `- [${sanitizeUntrusted(outcome.id, 40)}] ${sanitizeUntrusted(outcome.statement, 300)}（看到什么算做到：${sanitizeUntrusted(outcome.observable, 300)}）`),
        ...(contract.boundaries.length === 0 ? [] : [`边界：${contract.boundaries.map(item => sanitizeUntrusted(item, 200)).join('；')}`]),
        ...(contract.nonGoals.length === 0 ? [] : [`不做：${contract.nonGoals.map(item => sanitizeUntrusted(item, 200)).join('；')}`]),
      ]),
    '交付时在仓库根目录写 `lodge-proof.json`：至少写 `{"entry":"能重跑的验证命令"}`；命令要在干净副本里能跑，能证明这一步的结果。写不出可执行证明就如实说明，不要伪造。',
    rework
      ? `${humanLabelOf()}说上一轮结果不对：${note === '' ? '没有补充说明，请重新对照目标。' : sanitizeUntrusted(note, 2000)}。先重读目标、done 和约束；如果目标理解有误，先在回复里指出并停止；否则按新要求重做。`
      : '',
    workPackage === null
      ? ''
      : Array.isArray(workPackage)
        ? `你的工作包：${workPackage.map(item => `${item.title}（${(item.files ?? []).join('、') || '未指定文件'}）`).join('；')}。按顺序做完，只改这些文件。`
        : `你的工作包：${workPackage.title}；只改 ${(workPackage.files ?? []).join('、') || '这一步需要的文件'}。`,
    ...stageGuidance({ readOnly }),
    buildMemberHandoff({ room, messages, memberId }),
    workspace.parallel === true
      ? workspace.isolation === 'worktree'
        ? '你在自己的 worktree 里与其他执行官并行工作；只改自己的 worktree，系统会把候选分支合并到房间分支。'
        : '你在自己的隔离副本里与其他执行官并行工作；只改自己的副本，系统会按文件合并到房间目录。'
      : '在当前工作文件夹完成。',
    port === undefined ? '' : `如需起本地服务，用 PORT=${port}。`,
    environment?.linked?.includes('node_modules')
      ? 'node_modules 已软链为只读依赖，不要修改它。'
      : '',
    workspace.candidate === true ? '系统会提交候选。' : '不要改房间记录。',
    '回复时像对同事说话：先说做了什么、结果怎样；有多条结果或问题时用短列表，单条一两句说完，不复述目标。',
    '做完直接汇报结果，不要写过程；最后一句写清交给谁（写名字，不带 @），复核和投递由系统安排。',
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}
