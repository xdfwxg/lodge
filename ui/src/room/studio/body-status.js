// 身体状态：成员此刻的载体在做什么、哪里不舒服。只做投影，不发请求。
const ERROR_LABEL = {
  quota: '额度不够',
  auth: '登录失效',
  rate_limit: '被限流',
  engine: '没回应',
}

const workingLabel = (member, room) => {
  if (member.role === 'lead') return '安排中'
  if (member.role !== 'verifier') return '处理中'
  return room?.independence === 'vendor' ? '独立复核中' : '自查中'
}

export const bodyStatuses = (room, members = []) => {
  const held = new Set(Array.isArray(room?.heldMembers) ? room.heldMembers : [])
  const presence = new Map((Array.isArray(room?.presence) ? room.presence : [])
    .map(item => [item.memberId, item.state]))
  const queued = new Set((Array.isArray(room?.turnQueue) ? room.turnQueue : [])
    .filter(item => item.state === 'queued')
    .map(item => item.memberId))
  const offline = typeof room?.connectionError === 'string' && room.connectionError !== ''
  const reviewing = room?.needsYou?.kind === 'review'
  return members.map(member => {
    const base = {
      memberId: member.id,
      name: member.name,
      role: member.role,
      engine: member.body?.engine ?? member.engine ?? '',
      model: member.body?.model ?? member.model ?? '',
    }
    if (room?.memberError?.memberId === member.id) {
      return { ...base, state: 'error', label: ERROR_LABEL[room.memberError.kind] ?? '没回应', tone: 'danger' }
    }
    if (offline) return { ...base, state: 'offline', label: '连接中断', tone: 'danger' }
    if (held.has(member.id)) return { ...base, state: 'held', label: '已叫停', tone: 'muted' }
    if (presence.get(member.id) === 'working') {
      return { ...base, state: 'working', label: workingLabel(member, room), tone: 'active' }
    }
    if (queued.has(member.id)) return { ...base, state: 'queued', label: '排队中', tone: 'waiting' }
    if (reviewing && member.role === 'verifier') {
      return {
        ...base,
        state: 'review',
        label: room?.independence === 'vendor' ? '独立复核中' : '自查中',
        tone: 'active',
      }
    }
    if (room?.state === 'paused') return { ...base, state: 'waiting', label: '等待', tone: 'muted' }
    return { ...base, state: 'idle', label: '在线', tone: 'idle' }
  })
}
