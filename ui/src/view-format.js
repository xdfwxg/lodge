

const MD = { code: { copyLabel: '复制', copiedLabel: '已复制' } }
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

const timeOf = ts => {
  try {
    return clock.format(new Date(ts))
  } catch {
    return ''
  }
}

const durationOf = value => {
  const total = Math.max(0, Math.floor((Number(value) || 0) / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}
const independenceOf = room => room.independenceLabel ?? '还没有说怎么验收'
const workspaceOf = room => {
  const caps = room.workspace?.capabilities
  if (!caps) return '有版本记录'
  if (caps.vcs === 'git') {
    return `有版本记录 · ${caps.isolation === 'worktree' ? '单独副本' : caps.isolation ?? '单独'}${caps.commit === false ? ' · 不改原文件' : ''}`
  }
  if (caps.vcs === 'demo') return '示例'
  return `${caps.vcs === 'none' ? '普通文件夹' : caps.vcs ?? '文件夹'} · ${caps.isolation === 'copy' ? '复制一份' : caps.isolation ?? '单独'} · ${caps.diff === 'manifest' ? '文件清单' : caps.diff ?? '没有改动'}`
}
const changeWordOf = room => room.workspace?.capabilities?.diff === 'manifest' ? '文件清单' : '改动'
const memberPermissionOf = (room, member) => {
  if (!member.permissions?.write) return member.permissions?.exec ? '只能看，能运行' : '只能看'
  return room.workspace?.capabilities?.isolation === 'copy' ? '写在副本里' : '写在单独副本里'
}

export {
  MD,
  timeOf,
  durationOf,
  independenceOf,
  workspaceOf,
  changeWordOf,
  memberPermissionOf,
}
