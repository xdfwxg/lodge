import { independenceLabel } from './digest.js'

const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value !== ''))]

// 完成态交付单只读投影：目标、阶段、命令、改动文件、结论与 commit。
export const buildDelivery = (room, messages = []) => {
  const stages = room.stages.map((stage, index) => {
    const stageMessages = messages.filter(message => (message.meta?.stage ?? 0) === index)
    const commands = stageMessages
      .filter(message => message.kind === 'evidence' && message.meta?.kind === 'command')
      .map(message => ({
        id: message.id,
        command: message.meta?.command ?? '',
        exit: message.meta?.exit ?? null,
        evidenceId: message.id,
        changedFiles: Array.isArray(message.meta?.changedFiles) ? message.meta.changedFiles : [],
        simulated: message.meta?.simulated === true,
      }))
    const verdicts = stageMessages
      .filter(message => message.kind === 'verdict')
      .map(message => ({
        id: message.id,
        authorId: message.authorId ?? 'verifier',
        pass: message.meta?.pass === true,
        text: message.text ?? '',
        evidenceId: message.meta?.evidenceId ?? null,
      }))
    const manual = stageMessages.find(message => message.kind === 'evidence' && message.meta?.kind === 'manual')
    return {
      index,
      title: stage.title,
      kind: stage.kind,
      state: stage.state,
      acceptance: stage.acceptance ?? null,
      commands,
      manual: manual === undefined ? null : { id: manual.id, text: manual.text ?? '' },
      verdicts,
      changedFiles: unique(commands.flatMap(command => command.changedFiles)),
    }
  })
  const commands = stages.flatMap(stage => stage.commands)
  const changedFiles = unique(stages.flatMap(stage => stage.changedFiles))
  const lastAt = messages.reduce((latest, message) => Math.max(latest, message.ts ?? 0), 0)
  return {
    roomId: room.id,
    name: room.name,
    goal: room.goal,
    completedAt: room.completedAt ?? (lastAt > 0 ? lastAt : null),
    commit: typeof room.completedCommit === 'string' && room.completedCommit !== '' ? room.completedCommit : null,
    independenceLabel: independenceLabel(room),
    seatNames: room.seatNames ?? {},
    workspace: {
      provider: room.workspace?.provider ?? 'git',
      vcs: room.workspace?.capabilities?.vcs ?? 'none',
    },
    stages,
    commands,
    changedFiles,
    evidenceCount: stages.reduce((total, stage) => total + stage.commands.length + (stage.manual === null ? 0 : 1), 0),
  }
}
