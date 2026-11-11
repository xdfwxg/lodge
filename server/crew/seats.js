// 席位是数据，三人组只是默认模板。模板可以单人、三席或自定义 N 席。
const TOOL_SCOPES = ['read', 'exec', 'write']
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\0') === [...b].sort().join('\0')
const isId = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)

const deliveryTriad = [
  {
    id: 'planner',
    name: '队长',
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
    prompt: '你是队长。先和人对齐目标：只问真正要人拍板的问题（最多 3 个），每个附推荐答案；不要改代码。用户确认阶段前不要派活；收到以「阶段已确认」开头的消息后，只 @执行 当前阶段，不要重复派活。',
  },
  {
    id: 'executor',
    name: '执行',
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
    prompt: '你是执行。只做当前指派给你的阶段；在给定工作目录里改文件、跑测试；完成后用一句话汇报改了什么、跑了什么。当前工作区内的写入与命令直接执行，不要请求批准；不要问问题，直接完成；不要自己 git commit / push，系统会提交候选并合并；不要 @验收，系统会自动复核。',
  },
  {
    id: 'verifier',
    name: '验收',
    title: '复核',
    role: 'verifier',
    station: '只读副本 · 独立复核',
    engine: 'claude-cli',
    permissions: { read: true, exec: true, write: false },
    writeScope: 'none',
    toolSurface: ['read', 'exec'],
    skills: [],
    mcp: [],
    approval: 'auto',
    speakBudget: 4,
    prompt: '你是验收。只读复核：打开改动、必要时重跑验收命令；不改交付文件。第一行只写 PASS 或 REJECT，说明从第二行开始。不要接受作者的口头描述。直接复核，不要请求批准，不要问问题。',
  },
]

const solo = [
  {
    id: 'solo',
    name: '执行',
    title: '实现',
    role: 'worker',
    station: 'worktree 写 · 小改动单人交付',
    engine: 'claude-cli',
    permissions: { read: true, exec: true, write: true },
    writeScope: 'own_worktree',
    toolSurface: ['read', 'exec', 'write'],
    skills: [],
    mcp: [],
    approval: 'auto',
    speakBudget: 8,
    prompt: '你是执行。这是一个单人房间：不做多人讨论，直接在当前工作区完成目标，跑测试，然后一句话汇报改了什么、跑了什么。不要请求批准，不要问问题；不要自己 git commit / push，系统会提交候选。',
  },
]

const ROLE_TEMPLATE = {
  lead: deliveryTriad[0],
  worker: deliveryTriad[1],
  verifier: deliveryTriad[2],
}
const ROLE_NAME = { lead: '队长', worker: '执行', verifier: '验收' }

export const TEMPLATES = {
  'delivery-triad': { id: 'delivery-triad', name: '交付三人组', seats: deliveryTriad },
  solo: { id: 'solo', name: '单人', seats: solo },
  custom: { id: 'custom', name: '自定义', seats: [] },
}
export const DEFAULT_TEMPLATE_ID = 'delivery-triad'
export const TEMPLATE_LIST = Object.values(TEMPLATES)
  .filter(template => template.seats.length > 0)
  .map(template => ({
    id: template.id,
    name: template.name,
    seats: template.seats.length,
  }))

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
    return cloneSeat({ ...base, id, name })
  })

  const { workers, verifiers } = roleSeats(seats)
  const workerRef = workers.map(seat => `@${seat.name}`).join('、') || '执行席位'
  const verifierRef = verifiers[0] === undefined ? '验收席位' : `@${verifiers[0].name}`
  return seats.map(seat => {
    if (seat.role === 'lead') {
      return { ...seat, prompt: seat.prompt.replaceAll('你是队长', `你是${seat.name}`).replaceAll('@执行', workerRef) }
    }
    if (seat.role === 'worker') {
      return { ...seat, prompt: seat.prompt.replaceAll('你是执行', `你是${seat.name}`).replaceAll('@验收', verifierRef) }
    }
    if (seat.role === 'verifier') {
      return { ...seat, prompt: seat.prompt.replaceAll('你是验收', `你是${seat.name}`) }
    }
    return seat
  })
}

export const roleSeats = seats => ({
  // 单人模板没有显式 lead：第一个席位就是这间房的负责人。
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
validateRoster(seatsFor('solo'))

export const min = n => n * 60_000
