// 成员运行态投影：基座已经保证同一房间一次只跑一个回合，这里把队列
// 从成员引用翻译成成员视角，供所有房型共用；不新增执行通道。
const membersOf = toMember => (typeof toMember === 'function' ? toMember : value => value)

export const memberQueueOf = ({ queue = [], toMember } = {}) => {
  const memberOf = membersOf(toMember)
  const byMember = new Map()
  for (const item of Array.isArray(queue) ? queue : []) {
    const memberId = memberOf(item?.memberRef)
    if (typeof memberId !== 'string' || memberId === '') continue
    const entry = {
      memberId,
      state: item.state === 'running' ? 'running' : 'queued',
      ...(Number.isInteger(item.position) ? { position: item.position } : {}),
      ...(Number.isInteger(item.of) ? { of: item.of } : {}),
      ...(typeof item.waitingForRef === 'string' && item.waitingForRef !== ''
        ? { waitingForMemberId: memberOf(item.waitingForRef) }
        : {}),
    }
    const previous = byMember.get(memberId)
    if (previous === undefined || (previous.state === 'queued' && entry.state === 'running')) byMember.set(memberId, entry)
  }
  return [...byMember.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
}

export const presenceOf = queue => queue.map(entry => ({
  memberId: entry.memberId,
  state: entry.state === 'running' ? 'working' : 'queued',
}))

export const heldMembersOf = ({ holds = {}, toMember } = {}) => {
  const memberOf = membersOf(toMember)
  return Object.keys(holds ?? {})
    .map(ref => memberOf(ref))
    .filter(memberId => typeof memberId === 'string' && memberId !== '')
}

export const heldMessageCountsOf = ({ heldMessages = {}, toMember } = {}) => {
  const memberOf = membersOf(toMember)
  const counts = {}
  for (const [ref, items] of Object.entries(heldMessages ?? {})) {
    const memberId = memberOf(ref)
    if (typeof memberId !== 'string' || memberId === '') continue
    const count = Array.isArray(items) ? items.length : 0
    if (count > 0) counts[memberId] = count
  }
  return counts
}

export const memberActivityOf = (chatBase, toMember) => {
  const turnQueue = memberQueueOf({ queue: chatBase?.queue, toMember })
  return {
    turnQueue,
    presence: presenceOf(turnQueue),
    heldMembers: heldMembersOf({ holds: chatBase?.holds, toMember }),
    heldMessages: heldMessageCountsOf({ heldMessages: chatBase?.heldMessages, toMember }),
  }
}
