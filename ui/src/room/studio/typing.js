const ACTIONS = {
  lead: '正在安排',
  planner: '正在安排',
  worker: '正在执行',
  executor: '正在执行',
  verifier: '正在复核',
}

const actionOf = member => ACTIONS[member?.roleKind ?? member?.role] ?? '正在处理'

const clip = (text, max = 28) => (text.length > max ? `${text.slice(0, max)}…` : text)

// 谁、在做什么、第几步：一行说清，不把工具细节搬进来。
export const studioTyping = (room, members = []) => {
  if (room?.state !== 'active') return null
  const busy = Array.isArray(room.busyMembers) ? room.busyMembers : []
  if (busy.length === 0) return null
  const people = busy.map(id => members.find(member => member.id === id) ?? { id })
  const actions = new Set(people.map(actionOf))
  const action = actions.size === 1 ? [...actions][0] : '正在并行处理'
  const stages = Array.isArray(room.stages) ? room.stages : []
  const index = stages.findIndex(stage => stage.state === 'active')
  const stage = index >= 0 ? stages[index] : null
  const step = stage === null
    ? ''
    : `第 ${index + 1} 步${stage.title ? `「${clip(stage.title)}」` : ''}`
  return {
    label: people.map(person => person.name ?? person.id).join('、'),
    detail: step === '' ? action : `${action} · ${step}`,
  }
}
