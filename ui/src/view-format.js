

const MD = { code: { copyLabel: '复制', copiedLabel: '已复制' } }
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

const timeOf = ts => {
  try {
    return clock.format(new Date(ts))
  } catch {
    return ''
  }
}

const money = micro => {
  const usd = micro / 1_000_000
  return `$${usd >= 1 ? usd.toFixed(2) : usd.toFixed(3)}`
}
const countOf = value => (value ?? 0).toLocaleString('zh-CN')
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
const independenceOf = room => room.independenceLabel ?? '独立性未标注'
const workspaceOf = room => {
  const caps = room.workspace?.capabilities
  if (!caps) return 'git（默认）'
  if (caps.vcs === 'git') {
    return `git · ${caps.isolation === 'worktree' ? 'worktree 隔离' : caps.isolation ?? '隔离'}${caps.commit === false ? ' · 无 commit' : ''}`
  }
  if (caps.vcs === 'demo') return '演示'
  return `${caps.vcs === 'none' ? '普通目录' : caps.vcs ?? '未知'} · ${caps.isolation === 'copy' ? '复制隔离' : caps.isolation ?? '隔离'} · ${caps.diff === 'manifest' ? '文件清单' : caps.diff ?? '无 diff'}`
}
const changeWordOf = room => room.workspace?.capabilities?.diff === 'manifest' ? '文件清单' : 'diff'
const seatPermissionOf = (room, seat) => {
  if (!seat.permissions?.write) return seat.permissions?.exec ? '只读 + 执行' : '只读'
  return room.workspace?.capabilities?.isolation === 'copy' ? '副本写' : 'worktree 写'
}

export {
  MD,
  timeOf,
  money,
  countOf,
  durationOf,
  independenceOf,
  workspaceOf,
  changeWordOf,
  seatPermissionOf,
}
