import { PERSONALITY_IDS, PERSONALITIES } from '../../../shared/personalities.js'

// 成员名字、默认值和模型选项在聊天和工作室内共用；只做纯数据整形，不碰 React。
export const ROLE_LABEL = { lead: '规划师', worker: '执行官', verifier: '验收员', participant: '成员' }

export const normalizeMembers = members => (Array.isArray(members) ? members : []).map(member => ({
  role: member.role,
  name: member.name || ROLE_LABEL[member.role] || member.role,
  ...(typeof member.reason === 'string' && member.reason !== '' ? { reason: member.reason } : {}),
  ...(member.prompt ? { prompt: member.prompt } : {}),
  ...(member.station ? { station: member.station } : {}),
  ...(member.engine ? { engine: member.engine } : {}),
  ...(member.model ? { model: member.model } : {}),
  ...(member.personality ? { personality: member.personality } : {}),
  ...(member.permissions && typeof member.permissions === 'object' ? { permissions: member.permissions } : {}),
}))

export const memberChoicesFrom = members => normalizeMembers(members)
  .map(member => ({ engine: member.engine ?? '', model: member.model ?? '', personality: member.personality ?? '' }))

export const defaultPersonalityId = index => PERSONALITY_IDS[index % PERSONALITY_IDS.length]

export { PERSONALITIES, PERSONALITY_IDS }

export const modelRowsFor = engine => {
  if (engine === undefined) return []
  const seen = new Set()
  const rows = []
  const add = (id, label) => {
    if (typeof id !== 'string' || id === '' || seen.has(id)) return
    seen.add(id)
    rows.push({ id, label: typeof label === 'string' && label !== '' ? label : id })
  }
  for (const option of engine.models?.options ?? []) add(option?.id, option?.label)
  add(engine.models?.default, engine.models?.default)
  return rows
}
