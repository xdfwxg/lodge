

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
const independenceOf = room => room.independenceLabel ?? '复核方式未标注'
const workspaceOf = room => {
  const caps = room.workspace?.capabilities
  if (!caps) return '版本管理（默认）'
  if (caps.vcs === 'git') {
    return `版本管理 · ${caps.isolation === 'worktree' ? '独立副本' : caps.isolation ?? '隔离'}${caps.commit === false ? ' · 不改版本' : ''}`
  }
  if (caps.vcs === 'demo') return '演示'
  return `${caps.vcs === 'none' ? '普通目录' : caps.vcs ?? '未知'} · ${caps.isolation === 'copy' ? '复制隔离' : caps.isolation ?? '隔离'} · ${caps.diff === 'manifest' ? '文件清单' : caps.diff ?? '无改动'}`
}
const changeWordOf = room => room.workspace?.capabilities?.diff === 'manifest' ? '文件清单' : '改动'
const seatPermissionOf = (room, seat) => {
  if (!seat.permissions?.write) return seat.permissions?.exec ? '只读 + 执行' : '只读'
  return room.workspace?.capabilities?.isolation === 'copy' ? '副本写入' : '独立副本写入'
}

export {
  MD,
  timeOf,
  durationOf,
  independenceOf,
  workspaceOf,
  changeWordOf,
  seatPermissionOf,
}
