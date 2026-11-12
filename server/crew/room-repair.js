// 开工卡已经问过并确认的内容，不该在房间里再拦一次。
export const normalizeManualStages = room => {
  if (room?.imported === true || room?.demo === true) return null
  const stages = Array.isArray(room.stages) ? room.stages : []
  let changed = false
  const next = stages.map(stage => {
    if (stage.state === 'passed' || stage.kind !== 'deliverable' || !/^manual$/i.test(stage.acceptance ?? '')) return stage
    changed = true
    const { acceptance, ...rest } = stage
    return { ...rest, kind: 'decision', manual: true }
  })
  return changed ? next : null
}

export const findRedundantOpeningGate = (room, roomFiles) => {
  if (room?.imported === true || room?.demo === true || room?.state !== 'active') return -1
  const stages = Array.isArray(room.stages) ? room.stages : []
  const index = stages.findIndex(stage => (
    stage.state === 'active' &&
    stage.kind === 'decision' &&
    /确认|对齐/.test(stage.title ?? '')
  ))
  if (index < 0) return -1
  const firstDeliverable = stages.findIndex(stage => stage.kind === 'deliverable')
  if (firstDeliverable >= 0 && index > firstDeliverable) return -1
  const confirmed = (roomFiles.readBrief(room)?.constraints ?? [])
    .some(line => typeof line === 'string' && line.startsWith('已确认：'))
  return confirmed ? index : -1
}
