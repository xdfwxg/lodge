// 目标岛的纯投影：只从房间与消息派生，方便测试，不依赖 React。
export const NEEDS_TONE = {
  question: 'waiting',
  decision: 'waiting',
  signoff: 'done',
  review: 'checking',
  rework: 'paused',
  setup: 'waiting',
  idle: 'paused',
  merge: 'paused',
  parallel: 'paused',
  budget: 'paused',
  mcp: 'paused',
}

export const STAGE_KIND = { decision: '决策 · 你确认才算过', deliverable: '交付 · 命令与证据说话' }
export const TASK_LABEL = { pending: '未开始', working: '在做', reported: '已交', done: '已完成', failed: '失败' }

export const activeIndex = room => room.stages.findIndex(stage => stage.state === 'active')
export const evidenceFor = (room, index) => room.messages.filter(message => (
  message.kind === 'evidence' && (message.meta?.stage ?? 0) === index
))
export const verdictFor = (room, index) => [...room.messages].reverse().find(message => (
  message.kind === 'verdict' && (message.meta?.stage ?? 0) === index
))
export const rejectsFor = (room, index) => room.messages.filter(message => (
  message.kind === 'verdict' && message.meta?.pass === false && (message.meta?.stage ?? 0) === index
))

export const islandStatus = room => {
  if (room.state === 'complete') return { label: '目标达成', tone: 'done' }
  if (room.state === 'stopped') return { label: '已停止', tone: 'stopped' }
  if (room.state === 'paused') {
    return ['idle', 'budget', 'mcp'].includes(room.needsYou?.kind)
      ? { label: room.needsYou.label, tone: 'paused' }
      : { label: '已暂停', tone: 'paused' }
  }
  if (room.busy === true) {
    const busy = Array.isArray(room.busySeats) ? room.busySeats : room.busySeat ? [room.busySeat] : []
    if (busy.length > 1) return { label: `${busy.length} 个执行在做`, tone: 'active' }
    const seat = room.seatSpecs?.find(item => item.id === busy[0])?.name
    return { label: `${seat ?? '席位'}在做`, tone: 'active' }
  }
  if (room.needsYou) {
    return { label: room.needsYou.label, tone: NEEDS_TONE[room.needsYou.kind] ?? 'waiting' }
  }
  return { label: '进行中', tone: 'active' }
}

export const trackTone = (room, stage, index) => {
  if (stage.state === 'passed') return 'passed'
  if (stage.state !== 'active') return 'pending'
  if (room.state === 'paused') return 'paused'
  if (room.needsYou?.stage === index && room.needsYou.kind === 'review') return 'checking'
  return 'active'
}

export const seatRole = (room, seatId) => (
  room.seatSpecs?.find(seat => seat.id === seatId)?.role
  ?? (seatId === 'planner' ? 'lead' : seatId === 'verifier' ? 'verifier' : 'worker')
)
export const leadOf = room => room.leadSeat ?? 'planner'
export const workerOf = room => room.workers?.[0] ?? 'executor'
export const verifierOf = room => room.verifiers?.[0] ?? null

export const workingSeats = (room, index) => {
  if (room.state !== 'active') return []
  if (room.live === true) return Array.isArray(room.busySeats) ? room.busySeats : room.busySeat ? [room.busySeat] : []
  const stage = room.stages[index]
  if (stage === undefined) return []
  if (room.openQuestion) return [leadOf(room)]
  if (stage.kind === 'decision') return [leadOf(room)]
  const verdict = verdictFor(room, index)
  if (verdict !== undefined) return []
  if (evidenceFor(room, index).length === 0) return room.workers ?? [workerOf(room)]
  const verifier = verifierOf(room)
  return verifier === null ? [] : [verifier]
}

export const seatTask = (seat, stage) => {
  if (seat.role === 'lead') {
    return stage.kind === 'decision' ? '讲清「做到什么算过」，等你拍板' : '拆出这一段的写范围与验收'
  }
  if (seat.role === 'worker') {
    return stage.acceptance ? `按 \`${stage.acceptance}\` 交付` : '交付这一步的产物'
  }
  if (seat.role === 'verifier') return '独立复跑，给 PASS 或 REJECT'
  return '只读观察'
}

export const seatState = (room, stage, index, seatId) => {
  const busy = Array.isArray(room.busySeats) ? room.busySeats : room.busySeat ? [room.busySeat] : []
  if (busy.includes(seatId)) return 'working'
  if (stage.state === 'passed') return 'done'
  if (stage.state === 'pending') return 'pending'
  if (room.state === 'paused' || room.state === 'stopped') return 'paused'
  const evidence = evidenceFor(room, index)
  const verdict = verdictFor(room, index)
  const role = seatRole(room, seatId)
  const task = stage.tasks?.find(item => item.owner === seatId)
  if (task?.status === 'failed') return 'failed'
  if (task?.status === 'reported' || task?.status === 'done') return 'done'
  const seatEvidence = room.messages.some(message => (
    message.kind === 'evidence' && message.authorId === seatId && (message.meta?.stage ?? 0) === index
  ))
  if (role === 'lead') return stage.kind === 'decision' ? (room.live === true ? 'idle' : 'working') : 'done'
  if (role === 'worker') {
    if (seatEvidence) return 'done'
    if (stage.kind !== 'deliverable') return 'pending'
    return room.live === true ? 'idle' : 'working'
  }
  if (role === 'verifier') {
    if (verdict !== undefined) return 'done'
    if (evidence.length === 0) return 'pending'
    return room.live === true ? 'idle' : 'working'
  }
  return 'idle'
}

export const goalAnswers = (room, selected) => {
  const current = activeIndex(room)
  const done = room.stages.filter(stage => stage.state === 'passed').length
  const stage = room.stages[selected]
  return [
    ['目标', room.brief?.objective || room.goal || '—', 'goal'],
    ['进度', room.state === 'complete'
      ? `${room.stages.length}/${room.stages.length} · 目标达成`
      : current >= 0
        ? `${current + 1}/${room.stages.length} · ${room.stages[current].title}`
        : `${done}/${room.stages.length} · 已停止`, 'progress'],
    ['怎么算过', stage === undefined
      ? '—'
      : stage.kind === 'deliverable'
        ? (stage.acceptance ?? '未写验收命令')
        : '你点过才算过', 'acceptance'],
  ]
}

// 收起栏的头像：优先当前阶段的任务负责人，没有任务时回到正在工作的席位。
export const goalFaces = (room, seats, current) => {
  const workers = workingSeats(room, current)
  const tasks = current >= 0 ? room.stages[current]?.tasks ?? [] : []
  const owners = [...new Set(tasks.map(task => task.owner))]
  const ids = owners.length > 0 ? owners : workers
  return {
    seats: seats.filter(seat => ids.includes(seat.id)),
    working: new Set([...workers, ...tasks.filter(task => task.status === 'working').map(task => task.owner)]),
  }
}
