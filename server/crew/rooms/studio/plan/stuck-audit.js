import * as log from '../../../log.js'
import { ROOM_STATE } from '../../../../../shared/states.js'
import { stuckDeliverableStage } from '../runtime/state-guard.js'

// 卡住的房间不会自己写库，所以不变量挂在写点上永远看不到它。
// 这里定期扫一遍活着的房间：只发现、只记录，不替人做任何决定。
export const createStuckAudit = ({ store, now = () => Date.now(), idleMs = 120_000, warn = message => log.warn(message) }) => {
  const reported = new Set()
  const audit = () => {
    const stuck = []
    for (const room of store.readRooms()) {
      if (room?.roomType !== 'studio' || room?.state !== ROOM_STATE.active) continue
      // 交接记录存在 assignments 表里，房间快照不带；不查表会把“复核正在进行”误判成没人管。
      const assignments = [
        ...(Array.isArray(room.assignments) ? room.assignments : []),
        ...(store.readAssignments?.(room.id, { limit: 200 }) ?? []),
      ]
      const index = stuckDeliverableStage({ ...room, assignments }, { now: now(), idleMs })
      if (index === null) {
        reported.delete(room.id)
        continue
      }
      stuck.push({ roomId: room.id, stage: index })
      if (reported.has(room.id)) continue
      reported.add(room.id)
      const reason = `第 ${index + 1} 步在做，但没有任何在跑或等人的交接`
      warn(`[state] ${room.id}: ${reason}`)
      try {
        store.appendEvent(room.id, 'state.violation', { violations: [reason], drift: [], source: 'audit' })
      } catch {}
    }
    return stuck
  }
  return { audit, reported }
}
