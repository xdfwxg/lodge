import { buildDelivery, deliveryMarkdown } from './delivery.js'
import { buildHandoff } from './handoff.js'
import { fail, ok } from './result.js'

export const createServiceDelivery = ({ store, handoff: handoffStore, workspaceRoot }) => {
  const { readRoom, readMessages } = store

  const deliveryExport = roomId => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    if (room.state !== 'complete') return fail('conflict', '房间还没有完成，没有交付单')
    const delivery = buildDelivery(room, readMessages(roomId))
    return ok({
      filename: `${(room.name || room.id).replace(/[\\/:*?"<>|]/g, '-')}.交付单.md`,
      text: deliveryMarkdown(delivery),
    })
  }

  const handoff = roomId => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    if (room.demo === true) return fail('conflict', '演示房间没有写入房间仓库，不能导出交接包')
    const bundle = buildHandoff(room, { handoffStore, workspaceRoot })
    if (bundle === null) return fail('conflict', '房间还没有 transcript.jsonl，不能导出交接包')
    return ok({ bundle })
  }

  return { deliveryExport, handoff }
}
