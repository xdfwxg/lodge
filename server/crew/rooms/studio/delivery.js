import { independenceLabel } from '../../digest.js'
import { memberLabelMap } from '../../member-labels.js'

const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value !== ''))]

const artifactList = (messages, roots = []) => {
  const normalizedRoots = roots.filter(root => typeof root === 'string' && root !== '').map(root => root.replace(/\/$/, ''))
  const byPath = new Map()
  for (const message of messages) {
    for (const artifact of message.meta?.artifacts ?? []) {
      if (artifact === null || typeof artifact !== 'object' || typeof artifact.path !== 'string' || artifact.path === '') continue
      if (normalizedRoots.length > 0 && !normalizedRoots.some(root => artifact.path === root || artifact.path.startsWith(`${root}/`))) continue
      byPath.set(artifact.path, {
        path: artifact.path,
        bytes: Number.isFinite(artifact.bytes) ? artifact.bytes : null,
      })
    }
  }
  return [...byPath.values()]
}

// 完成态交付卡只读投影：目标、阶段、命令、改动文件、结论与 commit。
export const buildDelivery = (room, messages = []) => {
  const stages = room.stages.map((stage, index) => {
    const stageMessages = messages.filter(message => (message.meta?.stage ?? 0) === index)
    const commands = stageMessages
      .filter(message => message.kind === 'evidence' && message.meta?.kind === 'command')
      .filter(message => !/^manual$/i.test(String(message.meta?.command ?? '').trim()))
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
    const manualFiles = Array.isArray(manual?.meta?.changedFiles)
      ? manual.meta.changedFiles
      : Array.isArray(manual?.meta?.files) ? manual.meta.files : []
    return {
      index,
      title: stage.title,
      kind: stage.kind,
      state: stage.state,
      acceptance: stage.acceptance ?? null,
      commands,
      manual: manual === undefined ? null : {
        id: manual.id,
        text: manual.text ?? '',
        changedFiles: manualFiles,
      },
      verdicts,
      changedFiles: unique([...commands.flatMap(command => command.changedFiles), ...manualFiles]),
    }
  })
  const commands = stages.flatMap(stage => stage.commands)
  const changedFiles = unique(stages.flatMap(stage => stage.changedFiles))
  const lastAt = messages.reduce((latest, message) => Math.max(latest, message.ts ?? 0), 0)
  const delivery = {
    roomId: room.id,
    name: room.name,
    goal: room.goal,
    sample: room.demo === true,
    completedAt: room.completedAt ?? (lastAt > 0 ? lastAt : null),
    commit: typeof room.completedCommit === 'string' && room.completedCommit !== '' ? room.completedCommit : null,
    independenceLabel: independenceLabel(room),
    memberNames: memberLabelMap(room),
    workspace: {
      provider: room.workspace?.provider ?? 'git',
      vcs: room.workspace?.capabilities?.vcs ?? 'none',
    },
    workspacePath: room.repoPath ?? Object.values(room.worktrees ?? {})[0] ?? null,
    sourcePath: room.sourceRepo ?? null,
    artifacts: artifactList(messages, [room.repoPath, ...Object.values(room.worktrees ?? {})]),
    stages,
    commands,
    changedFiles,
    openQuestions: typeof room.openQuestion === 'string' && room.openQuestion.trim() !== ''
      ? [room.openQuestion.trim()]
      : [],
    evidenceCount: stages.reduce((total, stage) => total + stage.commands.length + (stage.manual === null ? 0 : 1), 0),
  }
  return delivery
}
