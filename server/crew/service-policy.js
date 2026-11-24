// 完成态留痕由工作区能力决定：commit、git 不可用、或只归档房间记录。
export const persistenceKind = capabilities => {
  if (capabilities?.commit === true) return 'commit'
  return capabilities?.vcs === 'git' ? 'git-unavailable' : 'archive'
}
