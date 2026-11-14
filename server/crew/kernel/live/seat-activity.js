// 席位运行态投影：基座已经保证同一房间一次只跑一个回合，这里把队列
// 从成员引用翻译成席位视角，供所有房型共用；不新增执行通道。
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

export const seatActivityOf = (chatBase, toSeat) => {
  const turnQueue = seatQueueOf({ queue: chatBase?.queue, toSeat })
  return { turnQueue, presence: presenceOf(turnQueue) }
}
