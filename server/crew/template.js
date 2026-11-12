import { parse as parseYaml } from 'yaml'

// 本地模板只提供名字、提示词、引擎与席位组合；权限始终由角色派生，模板不能提权。
export const MAX_TEMPLATE_BYTES = 200_000

const ROLE_OF = {
  planner: 'lead',
  lead: 'lead',
  executor: 'worker',
  worker: 'worker',
  verifier: 'verifier',
}

const EXPECTED = {
  lead: { permissions: ['read'], writeScope: 'none' },
  worker: { permissions: ['read', 'exec', 'write'], writeScope: 'own_worktree' },
  verifier: { permissions: ['read', 'exec'], writeScope: 'none' },
}
const ROLE_LABEL = { lead: '队长', worker: '执行', verifier: '验收' }
const isId = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)

const declaredPermissions = value => {
  if (Array.isArray(value)) return value.filter(item => ['read', 'exec', 'write'].includes(item))
  if (value !== null && typeof value === 'object') {
    return ['read', 'exec', 'write'].filter(key => value[key] === true)
  }
  return null
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\0') === [...b].sort().join('\0')

const parseSource = (text, filename) => {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') throw new Error('模板文件是空的')
  if (filename.endsWith('.json') || trimmed.startsWith('{')) return JSON.parse(trimmed)
  return parseYaml(trimmed)
}

export const parseTemplate = (text, filename = '') => {
  if (String(text ?? '').length > MAX_TEMPLATE_BYTES) throw new Error('模板文件超过 200KB')
  const raw = parseSource(text, filename)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('模板必须是对象')
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : ''
  if (name === '') throw new Error('模板缺少 name')
  if (!Array.isArray(raw.seats) || raw.seats.length === 0) throw new Error('模板缺少 seats')
  if (raw.seats.length > 12) throw new Error('模板席位太多（最多 8 个 AI 席位）')

  const seats = []
  const skipped = []
  for (const seat of raw.seats) {
    if (seat === null || typeof seat !== 'object') throw new Error('模板里有不可用的席位')
    if (seat.kind === 'human') {
      skipped.push(typeof seat.name === 'string' ? seat.name : 'human')
      continue
    }
    const key = typeof seat.key === 'string' ? seat.key : typeof seat.id === 'string' ? seat.id : ''
    const role = typeof seat.role === 'string' ? seat.role : ROLE_OF[key] ?? ROLE_OF[seat.kind]
    if (!['lead', 'worker', 'verifier'].includes(role)) {
      throw new Error(`模板席位 ${key || '?'} 没有可识别的角色`)
    }
    const expected = EXPECTED[role]
    const declared = declaredPermissions(seat.permissions)
    if (declared !== null && !sameSet(declared, expected.permissions)) {
      throw new Error(`模板席位 ${key || role} 的权限与角色不符；权限由角色派生，模板不能提权`)
    }
    if (typeof seat.write_scope === 'string' && seat.write_scope !== expected.writeScope) {
      throw new Error(`模板席位 ${key || role} 的写范围与角色不符`)
    }
    const prompt = typeof seat.system_prompt === 'string'
      ? seat.system_prompt
      : typeof seat.prompt === 'string' ? seat.prompt : ''
    const engine = typeof seat.engine === 'string' && !['any', 'none'].includes(seat.engine)
      ? seat.engine.trim().slice(0, 40)
      : ''
    seats.push({
      role,
      name: typeof seat.name === 'string' && seat.name.trim() !== '' ? seat.name.trim().slice(0, 32) : ROLE_LABEL[role],
      prompt: prompt.trim().slice(0, 4_000),
      station: typeof seat.station === 'string' ? seat.station.trim().slice(0, 80) : '',
      ...(engine === '' ? {} : { engine }),
    })
  }

  if (seats.length === 0) throw new Error('模板没有 AI 席位')
  if (seats.length > 8) throw new Error('模板 AI 席位最多 8 个')
  const count = role => seats.filter(seat => seat.role === role).length
  if (count('lead') > 1) throw new Error('模板最多一个队长')
  if (count('worker') === 0) throw new Error('模板至少需要一个执行')

  const id = isId(raw.id) ? raw.id : `template-${Date.now().toString(36)}`
  return {
    id,
    name,
    description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 500) : '',
    seats,
    skippedHumans: skipped,
  }
}
