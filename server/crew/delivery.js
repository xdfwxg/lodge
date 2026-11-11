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
  const delivery = {
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
  return delivery
}

export const deliveryMarkdown = delivery => {
  const lines = [
    `# 交付单：${delivery.name ?? '交付'}`,
    '',
    `目标：${delivery.goal ?? '—'}`,
    `完成时间：${delivery.completedAt === null || delivery.completedAt === undefined ? '未记录' : new Date(delivery.completedAt).toISOString()}`,
    `独立性：${delivery.independenceLabel ?? '未标注'}`,
    `工作区：${delivery.workspace?.provider ?? '—'} / ${delivery.workspace?.vcs ?? '—'}`,
    `结论 commit：${delivery.commit ?? '无'}`,
    '',
    '## 阶段',
  ]
  for (const stage of delivery.stages ?? []) {
    lines.push(`### ${stage.index + 1}. ${stage.title}（${stage.kind === 'deliverable' ? '交付' : '决策'}）`)
    if (stage.acceptance) lines.push(`- 验收命令：\`${stage.acceptance}\``)
    for (const command of stage.commands) {
      lines.push(`- 命令：\`${command.command}\` · exit ${command.exit === null ? '无' : command.exit}`)
    }
    for (const verdict of stage.verdicts) {
      const name = delivery.seatNames?.[verdict.authorId] ?? verdict.authorId
      lines.push(`- 复核：${name} · ${verdict.pass ? 'PASS' : 'REJECT'}`)
    }
    if (stage.changedFiles.length > 0) lines.push(`- 改动文件：${stage.changedFiles.join('、')}`)
  }
  lines.push('', '## 改动文件')
  lines.push(...(delivery.changedFiles ?? []).map(file => `- ${file}`))
  if ((delivery.changedFiles ?? []).length === 0) lines.push('- 无')
  lines.push('', '> 由 Lodge 从房间记录与证据派生；成本与 Token 是基座估算，不是账单。')
  return `${lines.join('\n')}\n`
}
