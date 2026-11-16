import { FAILURE_LABELS } from '../../../shared/failure.js'

// 身体状态：成员此刻的载体在做什么、哪里不舒服。只做投影，不发请求。

const workingLabel = (member, room, labels) => {
  if (member.role === 'lead') return labels.lead ?? '安排中'
  if (member.role !== 'verifier') return labels.member ?? '处理中'
  return room?.independence === 'vendor' ? '独立复核中' : '自查中'
}

export const bodyStatuses = (room, members = [], { labels = {} } = {}) => {
  const held = new Set(Array.isArray(room?.heldMembers) ? room.heldMembers : [])
  const working = new Set(Array.isArray(room?.busyMembers) ? room.busyMembers : [])
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
      engine: member.body?.engine ?? '',
      model: member.body?.model ?? '',
    }
    if (room?.memberError?.memberId === member.id) {
      return { ...base, state: 'error', label: FAILURE_LABELS[room.memberError.kind] ?? FAILURE_LABELS.engine, tone: 'danger' }
    }
    if (offline) return { ...base, state: 'offline', label: '连接中断', tone: 'danger' }
    if (held.has(member.id)) return { ...base, state: 'held', label: '已叫停', tone: 'muted' }
    if (working.has(member.id)) {
      return { ...base, state: 'working', label: workingLabel(member, room, labels), tone: 'active' }
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
