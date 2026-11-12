// 完成态留痕由工作区能力决定：commit、git 不可用、或只归档房间记录。
export const persistenceKind = capabilities => {
  if (capabilities?.commit === true) return 'commit'
  return capabilities?.vcs === 'git' ? 'git-unavailable' : 'archive'
}

export const acceptanceChangeError = (stage, command) => {
  if (stage === undefined) return ['invalid', '没有这个阶段']
  if (stage.kind !== 'deliverable') return ['invalid', '只有交付型阶段能设置验收命令']
  if (stage.state === 'passed') return ['conflict', '这个阶段已经过了']
  const trimmed = command.trim()
  if (trimmed.length > 500) return ['invalid', '验收命令不超过 500 字']
  if (trimmed === '' && stage.state === 'active') return ['conflict', '进行中的交付型阶段不能清空验收命令；先暂停或停止']
  return null
}
