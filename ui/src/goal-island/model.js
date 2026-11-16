// 目标岛的纯投影：只从房间与消息派生，方便测试，不依赖 React。
import { memberNameOf } from '../room/member-name.js'

const NEEDS_TONE = {
  question: 'waiting',
  decision: 'waiting',
  signoff: 'done',
  review: 'checking',
  rework: 'paused',
  setup: 'waiting',
  approval: 'waiting',
  idle: 'paused',
  merge: 'paused',
  parallel: 'paused',
  mcp: 'paused',
}

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

export const islandStatus = room => {
  if (room.state === 'complete') return { label: '已交付', tone: 'done' }
  if (room.state === 'stopped') return { label: '已停止', tone: 'stopped' }
  if (room.state === 'paused') {
    if (room.needsYou?.kind === 'idle') return { label: '已暂停 · 可以接着聊', tone: 'paused' }
    return ['mcp', 'approval'].includes(room.needsYou?.kind)
      ? { label: room.needsYou.label, tone: 'paused' }
      : { label: '已暂停', tone: 'paused' }
  }
  if (room.busy === true) {
    const busy = Array.isArray(room.busyMembers) ? room.busyMembers : room.busyMember ? [room.busyMember] : []
    if (busy.length > 1) return { label: `${busy.length} 个执行在做`, tone: 'active' }
    const member = room.members?.find(item => item.id === busy[0])?.name
    return { label: `${member ?? '成员'}在做`, tone: 'active' }
  }
  if (room.needsYou) {
    return { label: room.needsYou.label, tone: NEEDS_TONE[room.needsYou.kind] ?? 'waiting' }
  }
  return { label: '正在做', tone: 'active' }
}

const memberRole = (room, memberId) => (
  room.members?.find(member => member.id === memberId)?.role
  ?? (memberId === 'planner' ? 'lead' : memberId === 'verifier' ? 'verifier' : 'worker')
)
export const memberTask = (member, stage) => {
  if (member.role === 'lead') {
    return stage.kind === 'decision' ? '讲清「怎样算做完」，由你确认' : '拆出这一步要改什么、怎么算过'
  }
  if (member.role === 'worker') {
    return stage.acceptance ? '按约定交付，并跑一次检查' : '交付这一步的结果'
  }
  if (member.role === 'verifier') return '独立检查，给出通过或退回'
  return '只读观察'
}

export const memberState = (room, stage, index, memberId) => {
  const busy = Array.isArray(room.busyMembers) ? room.busyMembers : room.busyMember ? [room.busyMember] : []
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

// 房间页只构造这份标准 view；换实现时不需要房间内部结构。
export const buildGoalView = (room, members) => {
  const current = activeIndex(room)
  const memberById = new Map(members.map(member => [member.id, member]))
  const nameOf = id => id === 'you' ? '你' : memberNameOf(room, id) || memberById.get(id)?.name || id
  const stages = room.stages.map((stage, index) => {
    const rejects = rejectsFor(room, index)
    const verifierIds = (room.members ?? []).filter(member => member.roleKind === 'verifier' || member.role === 'verifier').map(member => member.id)
    const multi = verifierIds.length > 1
    let verdict = multi ? null : verdictFor(room, index)
    let verdicts = []
    if (multi) {
      const latest = verdictsFor(room, index)
      const byMember = new Map(latest.map(message => [message.authorId ?? 'verifier', message]))
      const received = verifierIds
        .map(id => ({ id, message: byMember.get(id) }))
        .filter(item => item.message !== undefined)
      const rejecting = received.filter(item => item.message.meta?.pass !== true)
      const missing = verifierIds.filter(id => !byMember.has(id))
      verdicts = received.map(item => ({
        author: nameOf(item.id),
        pass: item.message.meta?.pass === true,
        text: item.message.text ?? '',
      }))
      verdict = received.length === 0
        ? null
        : rejecting.length > 0
          ? { pass: false, text: `退回了：${rejecting.map(item => nameOf(item.id)).join('、')}` }
          : missing.length === 0
            ? { pass: true, text: `全部 ${verifierIds.length} 位验收员通过` }
            : { pass: false, pending: true, text: `已收到 ${received.length}/${verifierIds.length} 位验收员的意见，等待其余` }
    }
    const tasks = (stage.tasks ?? []).map(task => ({ ...task, member: memberById.get(task.owner) ?? null }))
    const taskOwners = new Set(tasks.map(task => task.owner))
    const conflict = room.mergeConflict?.stage === index ? room.mergeConflict : null
    return {
      index,
      title: stage.title,
      kind: stage.kind,
      state: stage.state,
      acceptance: stage.acceptance ?? null,
      acceptanceLabel: stage.kind === 'deliverable' ? (stage.acceptance ?? '还没有检查方式') : '你点过才算过',
      dependsOn: Array.isArray(stage.dependsOn) ? stage.dependsOn : [],
      conflict,
      reworkCount: rejects.length,
      rework: [...rejects].reverse().map(message => ({
        id: message.id,
        author: nameOf(message.authorId),
        at: message.ts ?? null,
        text: message.text || '验收员退回',
      })),
      evidence: evidenceFor(room, index).map(message => ({
        id: message.id,
        href: `/api/rooms/${room.id}/evidence/${message.id}`,
        manual: message.meta?.kind === 'manual',
        command: message.meta?.command ?? '命令',
        exit: message.meta?.exit ?? null,
      })),
      verdict: verdict === undefined || verdict === null
        ? null
        : multi
          ? verdict
          : { pass: verdict.meta?.pass === true, text: verdict.text ?? '' },
      verdicts,
      tasks,
      otherMembers: members.filter(member => !taskOwners.has(member.id)).map(member => ({
        member,
        state: memberState(room, stage, index, member.id),
        task: memberTask(member, stage),
      })),
    }
  })
  const done = room.stages.filter(stage => stage.state === 'passed').length
  return {
    id: room.id,
    name: room.name,
    goal: room.goal,
    state: room.state,
    brief: room.brief ?? null,
    status: islandStatus(room),
    progress: {
      value: room.state === 'complete' ? room.stages.length : current >= 0 ? current + 1 : done,
      total: room.stages.length,
    },
    stages,

  }
}
