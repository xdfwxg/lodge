// 席位是数据；当前产品默认固定为规划师、执行者、验收员三人，自定义编制是未开放扩展。
const TOOL_SCOPES = ['read', 'exec', 'write']
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\0') === [...b].sort().join('\0')
const isId = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)

const deliveryTriad = [
  {
    id: 'planner',
    name: '规划师',
    title: '规划',
    role: 'lead',
    station: '只读 · 拆阶段与派活',
    engine: 'claude-cli',
    permissions: { read: true, exec: false, write: false },
    writeScope: 'none',
    toolSurface: ['read'],
    skills: [],
    mcp: [],
    approval: 'ask',
    speakBudget: 6,
    prompt: '你是规划师。你的执行席位是 @执行者，验收席位是 @验收员。用简洁、直接的中文沟通；先理解目标与证据，再表达判断；不确定就说不确定。',
  },
  {
    id: 'executor',
    name: '执行者',
    title: '实现',
    role: 'worker',
    station: 'worktree 写 · 改代码跑测试',
    engine: 'codex-cli',
    permissions: { read: true, exec: true, write: true },
    writeScope: 'own_worktree',
    toolSurface: ['read', 'exec', 'write'],
    skills: [],
    mcp: [],
    approval: 'auto',
    speakBudget: 8,
    prompt: '你是执行者。你的验收席位是 @验收员。用简洁、直接的中文沟通；只围绕当前指派工作；完成后说明结果。',
  },
  {
    id: 'verifier',
    name: '验收员',
    title: '复核',
    role: 'verifier',
    station: '只读副本 · 独立复核',
    engine: 'claude-cli',
    permissions: { read: true, exec: true, write: false },
    writeScope: 'none',
    toolSurface: ['read', 'exec'],
    skills: [],
    mcp: [],
    approval: 'ask',
    speakBudget: 4,
    prompt: '你是验收员。用简洁、直接的中文沟通；只依据证据判断，不替执行者解释。',
  },
]

const ROLE_TEMPLATE = {
  lead: deliveryTriad[0],
  worker: deliveryTriad[1],
  verifier: deliveryTriad[2],
}
const ROLE_NAME = { lead: '规划师', worker: '执行者', verifier: '验收员' }

export const TEMPLATES = {
  'delivery-triad': { id: 'delivery-triad', name: '交付三人组', seats: deliveryTriad },
  custom: { id: 'custom', name: '自定义', seats: [] },
}
export const DEFAULT_TEMPLATE_ID = 'delivery-triad'

const cloneSeat = seat => ({
  ...seat,
  permissions: { ...seat.permissions },
  toolSurface: [...seat.toolSurface],
  skills: [...seat.skills],
  mcp: seat.mcp.map(grant => ({ ...grant, scopes: [...grant.scopes] })),
})

export const seatsFor = (id = DEFAULT_TEMPLATE_ID) => {
  const template = TEMPLATES[id] ?? TEMPLATES[DEFAULT_TEMPLATE_ID]
  return template.seats.map(cloneSeat)
}

// 自定义编制：请求只声明角色与名字，权限仍由角色派生，不让界面自己发明能力。
export const rosterFromRoles = entries => {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('seat contract: a custom roster needs at least one seat')
  }
  const counts = {}
  const seats = entries.map(entry => {
    const role = entry?.role
    const base = ROLE_TEMPLATE[role]
    if (base === undefined) throw new Error(`seat contract: unknown role ${role}`)
    counts[role] = (counts[role] ?? 0) + 1
    const id = counts[role] === 1 ? role : `${role}-${counts[role]}`
    const fallback = counts[role] === 1 ? ROLE_NAME[role] : `${ROLE_NAME[role]} ${counts[role]}`
    const raw = typeof entry.name === 'string' ? entry.name.trim() : ''
    const name = raw === '' ? fallback : raw.slice(0, 32)
    const customPrompt = typeof entry.prompt === 'string' && entry.prompt.trim() !== ''
    const engineExplicit = typeof entry.engine === 'string' && entry.engine.trim() !== ''
    const engine = engineExplicit ? entry.engine.trim().slice(0, 40) : base.engine
    const station = typeof entry.station === 'string' && entry.station.trim() !== '' ? entry.station.trim().slice(0, 80) : base.station
    return cloneSeat({
      ...base,
      id,
      name,
      engine,
      engineExplicit,
      station,
      prompt: customPrompt ? entry.prompt.trim().slice(0, 4_000) : base.prompt,
      customPrompt,
    })
  })

  const { workers, verifiers } = roleSeats(seats)
  const workerRef = workers.map(seat => `@${seat.name}`).join('、') || '执行席位'
  const verifierRef = verifiers.length === 0 ? '验收席位' : verifiers.map(seat => `@${seat.name}`).join('、')
  return seats.map(seat => {
    if (seat.customPrompt === true) return seat
    if (seat.role === 'lead') {
      return { ...seat, prompt: seat.prompt.replaceAll('你是规划师', `你是${seat.name}`).replaceAll('@执行者', workerRef) }
    }
    if (seat.role === 'worker') {
      return { ...seat, prompt: seat.prompt.replaceAll('你是执行者', `你是${seat.name}`).replaceAll('@验收员', verifierRef) }
    }
    if (seat.role === 'verifier') {
      return { ...seat, prompt: seat.prompt.replaceAll('你是验收员', `你是${seat.name}`) }
    }
    return seat
  })
}

export const roleSeats = seats => ({
  // 自定义扩展可能没有显式 lead：第一个席位就是这间房的负责人。
  lead: seats.find(seat => seat.role === 'lead') ?? seats[0],
  workers: seats.filter(seat => seat.role === 'worker'),
  verifiers: seats.filter(seat => seat.role === 'verifier'),
  observers: seats.filter(seat => seat.role === 'observer'),
})

const validateCapabilities = seat => {
  if (!['lead', 'worker', 'verifier', 'observer'].includes(seat.role)) {
    throw new Error(`seat contract: ${seat.id} has an invalid role`)
  }
  if (!Array.isArray(seat.skills) || seat.skills.some(id => !isId(id))) {
    throw new Error(`seat contract: ${seat.id} skills must be ids, not content`)
  }
  if (!Array.isArray(seat.mcp)) throw new Error(`seat contract: ${seat.id} mcp must be an array`)
  for (const grant of seat.mcp) {
    if (!isId(grant?.server)) {
      throw new Error(`seat contract: ${seat.id} mcp server must be a name, not a URL or credential`)
    }
    if (!Array.isArray(grant.scopes) || grant.scopes.length === 0 || grant.scopes.some(scope => !TOOL_SCOPES.includes(scope))) {
      throw new Error(`seat contract: ${seat.id} mcp scopes are invalid`)
    }
    if (grant.approval !== 'ask') {
      throw new Error(`seat contract: ${seat.id} external tools require approval`)
    }
  }
  if (!['ask', 'auto'].includes(seat.approval)) {
    throw new Error(`seat contract: ${seat.id} approval must be ask or auto`)
  }
  if (seat.mcp.length > 0 && seat.approval !== 'ask') {
    throw new Error(`seat contract: ${seat.id} external tools require approval mode ask`)
  }
  if (!Array.isArray(seat.toolSurface) || seat.toolSurface.some(tool => !TOOL_SCOPES.includes(tool))) {
    throw new Error(`seat contract: ${seat.id} toolSurface is invalid`)
  }
  const declared = TOOL_SCOPES.filter(tool => seat.permissions?.[tool] === true)
  if (!sameSet(seat.toolSurface, declared)) {
    throw new Error(`seat contract: ${seat.id} toolSurface must match permissions`)
  }
}

export const validateRoster = seats => {
  if (!Array.isArray(seats) || seats.length < 1 || seats.length > 8) {
    throw new Error('seat contract: a roster needs 1–8 seats')
  }
  const ids = seats.map(seat => seat.id)
  if (new Set(ids).size !== ids.length || ids.some(id => !isId(id))) {
    throw new Error('seat contract: seat ids must be unique names')
  }
  for (const seat of seats) validateCapabilities(seat)
  const { workers, verifiers } = roleSeats(seats)
  const leads = seats.filter(seat => seat.role === 'lead')
  if (leads.length > 1) throw new Error('seat contract: at most one lead')
  if (workers.length === 0) throw new Error('seat contract: at least one worker is required')
  for (const worker of workers) {
    if (worker.permissions?.read !== true || worker.permissions?.write !== true || worker.writeScope !== 'own_worktree') {
      throw new Error(`seat contract: worker ${worker.id} may write only its own worktree`)
    }
  }
  for (const verifier of verifiers) {
    if (verifier.permissions?.read !== true || verifier.permissions?.exec !== true || verifier.permissions?.write === true) {
      throw new Error(`seat contract: verifier ${verifier.id} must be read+exec with no write`)
    }
    if (verifier.mcp.length > 0) throw new Error('seat contract: external tools belong to a separate role, not verifier')
  }
  const lead = roleSeats(seats).lead
  if (lead.role === 'lead' && lead.mcp.length > 0) {
    throw new Error('seat contract: external tools belong to a separate role, not lead')
  }
  return seats
}

export const SEATS = seatsFor(DEFAULT_TEMPLATE_ID)
export const SEAT_IDS = SEATS.map(seat => seat.id)
export const validateSeats = validateRoster
validateRoster(SEATS)

export const min = n => n * 60_000
