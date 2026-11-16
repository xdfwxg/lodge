// 成员运行态投影：基座已经保证同一房间一次只跑一个回合，这里把队列
// 从成员引用翻译成成员视角，供所有房型共用；不新增执行通道。
const seatsOf = toSeat => (typeof toSeat === 'function' ? toSeat : value => value)

export const seatQueueOf = ({ queue = [], toSeat } = {}) => {
  const seatOf = seatsOf(toSeat)
  const bySeat = new Map()
  for (const item of Array.isArray(queue) ? queue : []) {
    const seatId = seatOf(item?.memberRef)
    if (typeof seatId !== 'string' || seatId === '') continue
    const entry = {
      seatId,
      state: item.state === 'running' ? 'running' : 'queued',
      ...(Number.isInteger(item.position) ? { position: item.position } : {}),
      ...(Number.isInteger(item.of) ? { of: item.of } : {}),
      ...(typeof item.waitingForRef === 'string' && item.waitingForRef !== ''
        ? { waitingForSeatId: seatOf(item.waitingForRef) }
        : {}),
    }
    const previous = bySeat.get(seatId)
    if (previous === undefined || (previous.state === 'queued' && entry.state === 'running')) bySeat.set(seatId, entry)
  }
  return [...bySeat.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
}

export const presenceOf = queue => queue.map(entry => ({
  seatId: entry.seatId,
  state: entry.state === 'running' ? 'working' : 'queued',
}))

export const heldSeatsOf = ({ holds = {}, toSeat } = {}) => {
  const seatOf = seatsOf(toSeat)
  return Object.keys(holds ?? {})
    .map(ref => seatOf(ref))
    .filter(seatId => typeof seatId === 'string' && seatId !== '')
}

export const heldMessageCountsOf = ({ heldMessages = {}, toSeat } = {}) => {
  const seatOf = seatsOf(toSeat)
  const counts = {}
  for (const [ref, items] of Object.entries(heldMessages ?? {})) {
    const seatId = seatOf(ref)
    if (typeof seatId !== 'string' || seatId === '') continue
    const count = Array.isArray(items) ? items.length : 0
    if (count > 0) counts[seatId] = count
  }
  return counts
}

export const seatActivityOf = (chatBase, toSeat) => {
  const turnQueue = seatQueueOf({ queue: chatBase?.queue, toSeat })
  return {
    turnQueue,
    presence: presenceOf(turnQueue),
    heldSeats: heldSeatsOf({ holds: chatBase?.holds, toSeat }),
    heldMessages: heldMessageCountsOf({ heldMessages: chatBase?.heldMessages, toSeat }),
  }
}
