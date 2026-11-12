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

// 多验收席位只看当前验收命令证据上的结论；旧轮 PASS 不能覆盖新一轮。
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
  const latestBySeat = new Map()
  for (const message of source) latestBySeat.set(message.authorId ?? 'verifier', message)
  return [...latestBySeat.values()]
}

export const verdictForSeat = (room, index, seatId) => (
  verdictsFor(room, index).find(message => (message.authorId ?? 'verifier') === seatId)
)

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
  if (Array.isArray(room.verifiers) && room.verifiers.length > 1) {
    if (evidenceFor(room, index).length === 0) return room.workers ?? [workerOf(room)]
    return room.verifiers.filter(id => verdictForSeat(room, index, id) === undefined)
  }
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
    if (Array.isArray(room.verifiers) && room.verifiers.length > 1) {
      if (verdictForSeat(room, index, seatId) !== undefined) return 'done'
      if (evidence.length === 0) return 'pending'
      return room.live === true ? 'idle' : 'working'
    }
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

// 房间页只构造这份标准 view；换实现时不需要房间内部结构。
export const buildGoalView = (room, seats) => {
  const current = activeIndex(room)
  const seatById = new Map(seats.map(seat => [seat.id, seat]))
  const nameOf = id => room.seatNames?.[id] ?? seatById.get(id)?.name ?? id
  const stages = room.stages.map((stage, index) => {
    const rejects = rejectsFor(room, index)
    const verifierIds = Array.isArray(room.verifiers) ? room.verifiers : []
    const multi = verifierIds.length > 1
    let verdict = multi ? null : verdictFor(room, index)
    let verdicts = []
    if (multi) {
      const latest = verdictsFor(room, index)
      const bySeat = new Map(latest.map(message => [message.authorId ?? 'verifier', message]))
      const received = verifierIds
        .map(id => ({ id, message: bySeat.get(id) }))
        .filter(item => item.message !== undefined)
      const rejecting = received.filter(item => item.message.meta?.pass !== true)
      const missing = verifierIds.filter(id => !bySeat.has(id))
      verdicts = received.map(item => ({
        author: nameOf(item.id),
        pass: item.message.meta?.pass === true,
        text: item.message.text ?? '',
      }))
      verdict = received.length === 0
        ? null
        : rejecting.length > 0
          ? { pass: false, text: `已打回：${rejecting.map(item => nameOf(item.id)).join('、')}` }
          : missing.length === 0
            ? { pass: true, text: `全部 ${verifierIds.length} 个验收席位 PASS` }
            : { pass: false, pending: true, text: `已回报 ${received.length}/${verifierIds.length} 个验收席位，等待其余` }
    }
    const tasks = (stage.tasks ?? []).map(task => ({ ...task, seat: seatById.get(task.owner) ?? null }))
    const taskOwners = new Set(tasks.map(task => task.owner))
    const conflict = room.mergeConflict?.stage === index
      ? room.mergeConflict
      : room.stageDispatch?.stage === index ? room.stageDispatch?.conflict ?? null : null
    return {
      index,
      title: stage.title,
      kind: stage.kind,
      state: stage.state,
      acceptance: stage.acceptance ?? null,
      acceptanceLabel: stage.kind === 'deliverable' ? (stage.acceptance ?? '未写验收命令') : '你点过才算过',
      dependsOn: Array.isArray(stage.dependsOn) ? stage.dependsOn : [],
      partial: stage.partial ?? null,
      partialFailedNames: (stage.partial?.failed ?? []).map(nameOf),
      conflict,
      reworkCount: rejects.length,
      rework: [...rejects].reverse().map(message => ({
        id: message.id,
        author: nameOf(message.authorId),
        at: message.ts ?? null,
        text: message.text || '验收席位打回',
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
      otherSeats: seats.filter(seat => !taskOwners.has(seat.id)).map(seat => ({
        seat,
        state: seatState(room, stage, index, seat.id),
        task: seatTask(seat, stage),
      })),
    }
  })
  const done = room.stages.filter(stage => stage.state === 'passed').length
  const faces = goalFaces(room, seats, current)
  return {
    id: room.id,
    name: room.name,
    goal: room.goal,
    state: room.state,
    brief: room.brief ?? null,
    imported: room.imported === true,
    status: islandStatus(room),
    badges: [
      ...(room.independence === 'vendor' ? [] : [{ label: room.independenceLabel ?? '独立性未标注', warn: true }]),
      ...(room.demo === true ? [{ label: '演示' }] : []),
      ...(room.imported === true ? [{ label: '交接 · 只读' }] : []),
      ...(room.workspace?.capabilities?.vcs !== undefined && !['git', 'demo'].includes(room.workspace.capabilities.vcs)
        ? [{ label: '无 VCS' }]
        : []),
      ...(room.live === true && room.imported !== true ? [{ label: '实时' }] : []),
    ],
    progress: {
      value: room.state === 'complete' ? room.stages.length : current >= 0 ? current + 1 : done,
      total: room.stages.length,
    },
    track: room.stages.map((stage, index) => trackTone(room, stage, index)),
    faces: faces.seats.map(seat => ({ seat, live: faces.working.has(seat.id) })),
    answers: {
      goal: room.brief?.objective || room.goal || '—',
      progress: room.state === 'complete'
        ? `${room.stages.length}/${room.stages.length} · 目标达成`
        : current >= 0
          ? `${current + 1}/${room.stages.length} · ${room.stages[current].title}`
          : `${done}/${room.stages.length} · 已停止`,
    },
    stages,
    controls: {
      imported: room.imported === true,
      canPause: room.imported !== true && room.state === 'active',
      canResume: room.imported !== true && room.state === 'paused',
      canStop: room.imported !== true && (room.state === 'active' || room.state === 'paused'),
      canContinue: room.imported === true || room.state === 'complete',
      canFork: room.imported !== true && (room.state === 'active' || room.state === 'paused'),
    },
  }
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
