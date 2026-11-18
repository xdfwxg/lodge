import { normalizeReceipt, receiptText } from '../../../../shared/receipt.js'

// 顶层房间不会完成为 complete，回执就从房间本身拼：阶段、检查、改动，不搬过程。
const deliveryOf = room => {
  if (room?.delivery !== null && room?.delivery !== undefined) return room.delivery
  const stages = Array.isArray(room?.stages) ? room.stages : []
  if (stages.length === 0 || stages.some(stage => stage.state !== 'passed')) return null
  const messages = Array.isArray(room?.messages) ? room.messages : []
  const commands = messages
    .filter(message => message.kind === 'evidence' && message.meta?.kind === 'command')
    .map(message => ({ exit: message.meta?.exit ?? null }))
  const files = new Set()
  for (const message of messages) {
    for (const file of message.meta?.files ?? []) files.add(file)
  }
  return {
    name: room?.name ?? '这次做出来的',
    stages,
    commands,
    changedFiles: [...files],
    openQuestions: [],
  }
}

// 工作室 → 聊天室只带回执：结果、完成度、检查与开放问题，不搬房间过程。
export const returnToChatSeed = room => {
  const delivery = deliveryOf(room)
  if (delivery === null || delivery === undefined) return null
  const commands = delivery.commands ?? []
  const stages = delivery.stages ?? []
  const done = stages.filter(stage => stage.state === 'passed').length
  const passed = commands.filter(command => command.exit === 0).length
  const changed = delivery.changedFiles?.length ?? 0
  const simulated = commands.some(command => command.simulated === true)
  const receipt = normalizeReceipt({
    result: delivery.name,
    completeness: stages.length > 0
      ? `${done}/${stages.length} 步完成${changed > 0 ? `，${changed} 个文件` : ''}`
      : changed > 0 ? `${changed} 个文件` : '已完成',
    checks: commands.length > 0
      ? [`${passed}/${commands.length} 项检查通过${simulated ? '（含模拟）' : ''}`]
      : ['人工验收通过'],
    openQuestions: delivery.openQuestions ?? [],
  })
  return {
    goal: `评审这次做出来的：${delivery.name}`,
    conclusion: receiptText(receipt),
    label: '这次做出来的',
    sourceName: delivery.name,
    sourceRoomId: room.id,
    receipt,
  }
}
