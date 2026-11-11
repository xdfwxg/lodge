import { roomNeedsYou } from './attention.js'
import { globalBudgetMicroUsd } from './budget.js'
import { buildDelivery } from './delivery.js'

// 调度台资源面板是只读投影：只汇总房间与消息，不路由、不执行。
export const buildResources = (rooms, readMessages = () => []) => {
  const items = rooms.map(room => {
    const messages = readMessages(room.id)
    const failedCommands = messages.filter(message => (
      message.kind === 'evidence' &&
      message.meta?.kind === 'command' &&
      message.meta?.exit !== 0
    )).length
    const rework = messages.filter(message => (
      message.kind === 'verdict' && message.meta?.pass === false
    )).length
    const conflicts = room.mergeConflict === undefined || room.mergeConflict === null ? 0 : 1
    const partial = (room.stages ?? []).filter(stage => (stage.partial?.failed?.length ?? 0) > 0).length
    return {
      roomId: room.id,
      name: room.name,
      state: room.state,
      needsYou: roomNeedsYou(room, messages),
      costMicroUsd: room.usage?.costMicroUsd ?? 0,
      turns: room.usage?.turns ?? 0,
      failedCommands,
      rework,
      conflicts,
      partial,
    }
  })
  const sum = key => items.reduce((total, item) => total + item[key], 0)
  const count = state => items.filter(item => item.state === state).length
  return {
    global: {
      rooms: items.length,
      active: count('active'),
      paused: count('paused'),
      stopped: count('stopped'),
      complete: count('complete'),
      needsYou: items.filter(item => item.needsYou !== null).length,
      costMicroUsd: sum('costMicroUsd'),
      budgetMicroUsd: globalBudgetMicroUsd(),
      turns: sum('turns'),
      failedCommands: sum('failedCommands'),
      rework: sum('rework'),
      conflicts: sum('conflicts'),
      partial: sum('partial'),
    },
    rooms: items.sort((a, b) => b.costMicroUsd - a.costMicroUsd),
    deliveries: rooms
      .filter(room => room.state === 'complete')
      .map(room => {
        const delivery = buildDelivery(room, readMessages(room.id))
        return {
          roomId: room.id,
          name: room.name,
          goal: room.goal,
          completedAt: delivery.completedAt,
          commit: delivery.commit,
          stages: delivery.stages.length,
          commands: delivery.commands.length,
          changedFiles: delivery.changedFiles.length,
        }
      })
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, 10),
  }
}
