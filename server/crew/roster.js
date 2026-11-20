import { personalityById } from '../../shared/personalities.js'
import { DEFAULT_STUDIO_ROSTER } from '../../shared/studio-roster.js'
import { materializeRole } from '../../shared/role-definitions.js'
import { isBrowserGrant } from '../../shared/room-access.js'
import { normalizeMcpGrants } from './body-spec.js'

// 成员是数据；当前产品默认固定为规划师、执行官、验收员三人，自定义编制是未开放扩展。
const ROLE_NAME = Object.fromEntries(DEFAULT_STUDIO_ROSTER.map(member => [member.role, member.name]))
const TOOL_SCOPES = ['read', 'exec', 'write']
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\0') === [...b].sort().join('\0')
const isId = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)

const deliveryTriad = ['lead', 'worker', 'verifier'].map(role => materializeRole(role))

const ROLE_TEMPLATE = {
  lead: deliveryTriad[0],
  worker: deliveryTriad[1],
  verifier: deliveryTriad[2],
}

// 底层 roleKind 只有三类本原能力；lead/worker 是界面角色名。
const ROLE_KIND = { lead: 'planner', worker: 'executor', verifier: 'verifier' }
export const roleKindOf = role => ROLE_KIND[role] ?? role

export const TEMPLATES = {
  'delivery-triad': { id: 'delivery-triad', name: '交付三人组', members: deliveryTriad },
  custom: { id: 'custom', name: '自定义', members: [] },
}
export const DEFAULT_TEMPLATE_ID = 'delivery-triad'

const cloneMember = member => ({
  ...member,
  permissions: { ...member.permissions },
  toolSurface: [...member.toolSurface],
  skills: [...member.skills],
  mcp: member.mcp.map(grant => ({ ...grant, scopes: [...grant.scopes] })),
})

export const membersFor = (id = DEFAULT_TEMPLATE_ID) => {
  const template = TEMPLATES[id] ?? TEMPLATES[DEFAULT_TEMPLATE_ID]
  return template.members.map(cloneMember)
}

// 自定义编制：请求只声明角色与名字，权限仍由角色派生，不让界面自己发明能力。
export const rosterFromRoles = entries => {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('member contract: a custom roster needs at least one member')
  }
  const counts = {}
  const members = entries.map(entry => {
    const role = entry?.role
    const base = ROLE_TEMPLATE[role]
    if (base === undefined) throw new Error(`member contract: unknown role ${role}`)
    counts[role] = (counts[role] ?? 0) + 1
    const id = counts[role] === 1 ? role : `${role}-${counts[role]}`
    const fallback = counts[role] === 1 ? ROLE_NAME[role] : `${ROLE_NAME[role]} ${counts[role]}`
    const raw = typeof entry.name === 'string' ? entry.name.trim() : ''
    const name = raw === '' ? fallback : raw.slice(0, 32)
    const customPrompt = typeof entry.prompt === 'string' && entry.prompt.trim() !== ''
    const engineExplicit = typeof entry.engine === 'string' && entry.engine.trim() !== ''
    const engine = engineExplicit ? entry.engine.trim().slice(0, 40) : base.engine
    const model = typeof entry.model === 'string' && entry.model.trim() !== ''
      ? entry.model.trim().slice(0, 160)
      : base.model
    const station = typeof entry.station === 'string' && entry.station.trim() !== '' ? entry.station.trim().slice(0, 80) : base.station
    const skills = Array.isArray(entry.skills) ? entry.skills.filter(isId).slice(0, 8) : base.skills
    const mcp = entry.mcp === undefined ? base.mcp : normalizeMcpGrants(entry.mcp)
    const personality = personalityById(entry.personality) === null ? '' : entry.personality
    return cloneMember({
      ...base,
      id,
      name,
      personality,
      engine,
      engineExplicit,
      model,
      station,
      skills,
      mcp,
      prompt: customPrompt ? entry.prompt.trim().slice(0, 4_000) : base.prompt,
      customPrompt,
    })
  })

  const { workers, verifiers } = roleMembers(members)
  const workerRef = workers.map(member => `@${member.name}`).join('、') || '执行成员'
  const verifierRef = verifiers.length === 0 ? '验收成员' : verifiers.map(member => `@${member.name}`).join('、')
  return members.map(member => {
    if (member.customPrompt === true) return member
    if (member.role === 'lead') {
      return { ...member, prompt: member.prompt.replaceAll('你是规划师', `你是${member.name}`).replaceAll('@执行官', workerRef) }
    }
    if (member.role === 'worker') {
      return { ...member, prompt: member.prompt.replaceAll('你是执行官', `你是${member.name}`).replaceAll('@验收员', verifierRef) }
    }
    if (member.role === 'verifier') {
      return { ...member, prompt: member.prompt.replaceAll('你是验收员', `你是${member.name}`) }
    }
    return member
  })
}

export const roleMembers = members => ({
  // 自定义扩展可能没有显式 lead：第一个成员就是这间房的负责人。
  lead: members.find(member => member.role === 'lead') ?? members[0],
  workers: members.filter(member => member.role === 'worker'),
  verifiers: members.filter(member => member.role === 'verifier'),
})

const validateCapabilities = member => {
  if (!['lead', 'worker', 'verifier'].includes(member.role)) {
    throw new Error(`member contract: ${member.id} has an invalid role`)
  }
  if (member.model !== undefined && (typeof member.model !== 'string' || member.model.trim() === '' || member.model.length > 160)) {
    throw new Error(`member contract: ${member.id} model must be a model id`)
  }
  if (!Array.isArray(member.skills) || member.skills.some(id => !isId(id))) {
    throw new Error(`member contract: ${member.id} skills must be base skill names`)
  }
  if (!Array.isArray(member.mcp)) throw new Error(`member contract: ${member.id} mcp must be an array`)
  for (const grant of member.mcp) {
    if (!isId(grant?.server)) {
      throw new Error(`member contract: ${member.id} mcp server must be a name, not a URL or credential`)
    }
    if (!Array.isArray(grant.scopes) || grant.scopes.length === 0 || grant.scopes.some(scope => !TOOL_SCOPES.includes(scope))) {
      throw new Error(`member contract: ${member.id} mcp scopes are invalid`)
    }
    if (grant.approval !== 'ask') {
      throw new Error(`member contract: ${member.id} external tools require approval`)
    }
  }
  if (!['ask', 'auto'].includes(member.approval)) {
    throw new Error(`member contract: ${member.id} approval must be ask or auto`)
  }
  if (member.mcp.length > 0 && member.approval !== 'ask') {
    throw new Error(`member contract: ${member.id} external tools require approval mode ask`)
  }
  if (!Array.isArray(member.toolSurface) || member.toolSurface.some(tool => !TOOL_SCOPES.includes(tool))) {
    throw new Error(`member contract: ${member.id} toolSurface is invalid`)
  }
  const declared = TOOL_SCOPES.filter(tool => member.permissions?.[tool] === true)
  if (!sameSet(member.toolSurface, declared)) {
    throw new Error(`member contract: ${member.id} toolSurface must match permissions`)
  }
}

export const validateRoster = (members, { requireWorker = true } = {}) => {
  if (!Array.isArray(members) || members.length < 1 || members.length > 8) {
    throw new Error('member contract: a roster needs 1–8 members')
  }
  const ids = members.map(member => member.id)
  if (new Set(ids).size !== ids.length || ids.some(id => !isId(id))) {
    throw new Error('member contract: member ids must be unique names')
  }
  for (const member of members) validateCapabilities(member)
  const { workers, verifiers } = roleMembers(members)
  if (verifiers.length > 1) throw new Error('member contract: at most one verifier')
  const leads = members.filter(member => member.role === 'lead')
  if (leads.length > 1) throw new Error('member contract: at most one lead')
  if (requireWorker && workers.length === 0) throw new Error('member contract: at least one worker is required')
  for (const worker of workers) {
    if (worker.permissions?.read !== true || worker.permissions?.write !== true || worker.writeScope !== 'own_worktree') {
      throw new Error(`member contract: worker ${worker.id} may write only its own worktree`)
    }
  }
  for (const verifier of verifiers) {
    if (verifier.permissions?.read !== true || verifier.permissions?.exec !== true || verifier.permissions?.write === true) {
      throw new Error(`member contract: verifier ${verifier.id} must be read+exec with no write`)
    }
    if (verifier.mcp.some(grant => !isBrowserGrant(grant))) {
      throw new Error('member contract: external tools belong to a separate role, not verifier')
    }
  }
  const lead = roleMembers(members).lead
  if (lead.role === 'lead' && lead.mcp.some(grant => !isBrowserGrant(grant))) {
    throw new Error('member contract: external tools belong to a separate role, not lead')
  }
  return members
}

export const ROLES = membersFor(DEFAULT_TEMPLATE_ID)
export const ROLE_IDS = ROLES.map(member => member.id)
validateRoster(ROLES)

export const min = n => n * 60_000
