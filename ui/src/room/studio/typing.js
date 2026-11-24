const ACTIONS = {
  lead: '正在安排',
  planner: '正在安排',
  worker: '正在执行',
  executor: '正在执行',
  verifier: '正在复核',
}

const VERBS = { read: '查看', write: '写文件', exec: '运行命令', gate: '提交判定' }

const actionOf = member => ACTIONS[member?.roleKind ?? member?.role] ?? '正在处理'

const clip = (text, max = 28) => (text.length > max ? `${text.slice(0, max)}…` : text)

const elapsedOf = ts => {
  if (!Number.isFinite(ts)) return ''
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (seconds < 3) return ''
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

// 工具名只说“在用什么”，工具在做什么（命令、文件）才是用户想知道的那一句。
const doingOf = message => {
  const meta = message?.meta ?? {}
  const action = String(meta.action ?? '')
  const verb = VERBS[action] ?? '处理'
  // 判定工具名是内部实现，用户只需要知道“在提交判定”。
  if (action === 'gate') return verb
  const raw = String(meta.target ?? meta.detail ?? message?.text ?? '').trim()
  const what = raw.split('\n')[0].trim()
  // heredoc 的开头（<<'EOF'）不是用户想读的动作；说“在跑命令”就够了。
  if (what === '' || (verb === '运行命令' && what.includes('<<'))) return verb
  return `${verb} ${clip(what, 40)}`
}

const stepOf = stages => {
  const index = stages.findIndex(stage => stage.state === 'active')
  const stage = index >= 0 ? stages[index] : null
  return stage === null ? '' : `第 ${index + 1} 步${stage.title ? `「${clip(stage.title)}」` : ''}`
}

// 谁、在做什么、第几步：一行说清，不把工具细节搬进来。
// 基座的 working 在长时间工具执行时可能为 false；这时用房间自己的活动和未结束的交接补一条心跳，
// 让用户始终看得到“还在跑、跑到哪一步”，而不是一片安静。
export const studioTyping = (room, members = []) => {
  if (room?.state !== 'active' || room?.needsYou !== null && room?.needsYou !== undefined) return null
  const stages = Array.isArray(room.stages) ? room.stages : []
  const step = stepOf(stages)
  const messages = Array.isArray(room.messages) ? room.messages : []
  const activity = [...messages].reverse().find(message => message.kind === 'activity' && message.authorId !== 'system')
  // 房间自己的信号优先：未结束的交接（sent/working）和基座报的忙碌合并成同一份心跳。
  const open = Array.isArray(room.assignments) ? room.assignments : []
  const openMembers = open
    .filter(item => item?.status === 'sent' || item?.status === 'working')
    .map(item => item.toMemberId)
    .filter(id => typeof id === 'string' && id !== '')
  const busy = Array.isArray(room.busyMembers) ? room.busyMembers : []
  const active = [...new Set([...openMembers, ...busy])]
  if (active.length > 0) {
    const people = active.map(id => members.find(member => member.id === id) ?? { id })
    const actions = new Set(people.map(actionOf))
    const action = actions.size === 1 ? [...actions][0] : '正在一起处理'
    const detail = [action, step].filter(Boolean).join(' · ')
    const current = activity !== undefined && active.includes(activity.authorId) ? activity : null
    return {
      label: people.map(person => person.name ?? person.id).join('、'),
      detail: current === null ? detail : [detail, doingOf(current), elapsedOf(current.ts)].filter(Boolean).join(' · '),
    }
  }

  // 用户刚说完、还没有人接话：至少告诉用户“已经收到，正在处理”。
  const last = messages.at(-1)
  if (last !== undefined && last.authorId === 'you') {
    const lead = members.find(member => member.role === 'lead' || member.roleKind === 'planner') ?? null
    return {
      label: lead?.name ?? '规划师',
      detail: ['正在处理', step, elapsedOf(last.ts)].filter(Boolean).join(' · '),
    }
  }
  return null
}
