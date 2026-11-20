// 房间共用的在场投影：谁在做、谁在排队、谁被挂起。
// 工作室时间线和“停下这一轮”按钮都读这一份，房间壳不依赖某个房型。
export const presenceLines = (room, members = [], now = Date.now()) => {
  const nameOf = id => members.find(member => member.id === id)?.name ?? id
  const queue = Array.isArray(room?.turnQueue) ? room.turnQueue : []
  const heldMembers = new Set(Array.isArray(room?.heldMembers) ? room.heldMembers : [])
  const held = [...heldMembers].map(memberId => ({
    memberId,
    name: nameOf(memberId),
    count: room?.heldMessages?.[memberId] ?? 0,
  }))
  const busy = Array.isArray(room?.busyMembers) ? room.busyMembers : []
  // 基座的 busy 标记有时比工具活动晚一拍；最近的工具活动也算“在做”，不能同时挂“等待别人”。
  const recent = new Map()
  for (const message of Array.isArray(room?.messages) ? room.messages : []) {
    if (message?.kind !== 'activity' || typeof message.ts !== 'number') continue
    if (now - message.ts > 2 * 60_000) continue
    if (!recent.has(message.authorId) || recent.get(message.authorId) < message.ts) {
      recent.set(message.authorId, message.ts)
    }
  }
  const workingIds = new Set([...busy, ...recent.keys()])
  const working = [...workingIds]
    .filter(memberId => !heldMembers.has(memberId))
    .map(memberId => ({ memberId, name: nameOf(memberId), since: busy.includes(memberId) ? room?.busySince ?? null : recent.get(memberId) }))
  const seen = new Set(working.map(item => item.memberId))
  const queued = queue
    .filter(item => item.state === 'queued' && !seen.has(item.memberId) && !heldMembers.has(item.memberId))
    .map(item => ({
      memberId: item.memberId,
      name: nameOf(item.memberId),
      position: item.position ?? null,
      of: item.of ?? null,
      waitingFor: item.waitingForMemberId === undefined ? '' : nameOf(item.waitingForMemberId),
    }))
  return { working, queued, held }
}
