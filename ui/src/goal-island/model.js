// 目标岛读取的房间投影：只从房间与消息派生，方便测试，不依赖 React。
export const activeIndex = room => room.stages.findIndex(stage => stage.state === 'active')
export const evidenceFor = (room, index) => room.messages.filter(message => (
  message.kind === 'evidence' && (message.meta?.stage ?? 0) === index
))
export const verdictFor = (room, index) => [...room.messages].reverse().find(message => (
  message.kind === 'verdict' && (message.meta?.stage ?? 0) === index
))

// 多验收成员只看当前验收命令证据上的结论；旧轮 PASS 不能覆盖新一轮。
export const verdictsFor = (room, index) => {
  const stage = room.stages?.[index]
  const evidence = [...room.messages].reverse().find(message => (
    message.kind === 'evidence' &&
    (message.meta?.stage ?? 0) === index &&
    (message.meta?.kind === 'command' || (room.demo === true && message.meta?.simulated === true)) &&
    (typeof stage?.acceptance !== 'string' || stage.acceptance.trim() === '' ||
      (typeof message.meta?.command === 'string' && message.meta.command.trim() === stage.acceptance.trim()))
  ))
  if (evidence !== undefined && evidence.meta?.exit !== 0) return []
  const all = room.messages.filter(message => (
    message.kind === 'verdict' && (message.meta?.stage ?? 0) === index
  ))
  const tagged = all.filter(message => typeof message.meta?.evidenceId === 'string')
  const source = evidence !== undefined && tagged.length > 0
    ? tagged.filter(message => message.meta.evidenceId === evidence.id)
    : all
  const latestByMember = new Map()
  for (const message of source) latestByMember.set(message.authorId ?? 'verifier', message)
  return [...latestByMember.values()]
}

export const verdictForMember = (room, index, memberId) => (
  verdictsFor(room, index).find(message => (message.authorId ?? 'verifier') === memberId)
)

export const rejectsFor = (room, index) => room.messages.filter(message => (
  (message.kind === 'verdict' && message.meta?.pass === false && (message.meta?.stage ?? 0) === index) ||
  (message.kind === 'rework' && (message.meta?.stage ?? 0) === index)
))

const memberRole = (room, memberId) => (
  room.members?.find(member => member.id === memberId)?.role
  ?? (memberId === 'planner' ? 'lead' : memberId === 'verifier' ? 'verifier' : 'worker')
)
export const memberTask = (member, stage) => {
  if (member.role === 'lead') {
    return stage.kind === 'decision' ? '讲清「怎样算做完」，由你确认' : '拆出这一步要改什么、怎么算过'
  }
  if (member.role === 'worker') {
    return stage.acceptance ? '按约定完成，并跑一次检查' : '完成这一步的结果'
  }
  if (member.role === 'verifier') return '独立检查，给出通过或退回'
  return '只读观察'
}

export const memberState = (room, stage, index, memberId) => {
  const busy = Array.isArray(room.busyMembers) ? room.busyMembers : []
  if (busy.includes(memberId)) return 'working'
  if (stage.state === 'passed') return 'done'
  if (stage.state === 'pending') return 'pending'
  if (room.state === 'paused' || room.state === 'stopped') return 'paused'
  const evidence = evidenceFor(room, index)
  const verdict = verdictFor(room, index)
  const role = memberRole(room, memberId)
  const task = stage.tasks?.find(item => item.owner === memberId)
  if (task?.status === 'failed') return 'failed'
  if (task?.status === 'reported' || task?.status === 'done') return 'done'
  const memberEvidence = room.messages.some(message => (
    message.kind === 'evidence' && message.authorId === memberId && (message.meta?.stage ?? 0) === index
  ))
  if (role === 'lead') return stage.kind === 'decision' ? (room.live === true ? 'idle' : 'working') : 'done'
  if (role === 'worker') {
    if (memberEvidence) return 'done'
    if (stage.kind !== 'deliverable') return 'pending'
    return room.live === true ? 'idle' : 'working'
  }
  if (role === 'verifier') {
    if ((room.members ?? []).filter(member => member.roleKind === 'verifier' || member.role === 'verifier').length > 1) {
      if (verdictForMember(room, index, memberId) !== undefined) return 'done'
      if (evidence.length === 0) return 'pending'
      return room.live === true ? 'idle' : 'working'
    }
    if (verdict !== undefined) return 'done'
    if (evidence.length === 0) return 'pending'
    return room.live === true ? 'idle' : 'working'
  }
  return 'idle'
}
