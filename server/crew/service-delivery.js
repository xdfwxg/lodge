import { buildDelivery, deliveryMarkdown } from './delivery.js'
import { buildHandoff } from './handoff.js'
import { fail, ok } from './result.js'

export const createServiceDelivery = ({ store, dataDir, deliveries, handoff: handoffStore, workspaceRoot }) => {
  const { readRoom, readRooms, readMessages } = store

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

  const deliveriesExport = () => ok({
    bundle: deliveries.bundle(readRooms(), readMessages),
  })

  const deliveriesImport = bundle => {
    if (typeof dataDir !== 'string' || dataDir === '') throw new Error('服务未配置 dataDir')
    try {
      const items = deliveries.import({ dataDir, bundle })
      return ok({ imported: items.length, deliveries: items })
    } catch (error) {
      return fail('invalid', String(error?.message ?? error))
    }
  }

  const handoff = roomId => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    if (room.demo === true) return fail('conflict', '演示房间没有写入房间仓库，不能导出交接包')
    const bundle = buildHandoff(room, { handoffStore, workspaceRoot })
    if (bundle === null) return fail('conflict', '房间还没有 transcript.jsonl，不能导出交接包')
    return ok({ bundle })
  }

  return { deliveryExport, deliveriesExport, deliveriesImport, handoff }
}
