export const isWorkStage = stage => stage.kind === 'deliverable' || stage.manual === true

export const activeStageReadOnly = room => (
  room?.stages?.find(stage => stage.state === 'active')?.readOnly === true
)

export const deliverableStageIndex = room => {
  const active = room.stages.findIndex(stage => stage.state === 'active' && isWorkStage(stage))
  if (active >= 0) return active
  const pending = room.stages.findIndex(stage => stage.state === 'pending' && isWorkStage(stage))
  if (pending >= 0) return pending
  const first = room.stages.findIndex(stage => isWorkStage(stage))
  return first >= 0 ? first : 0
}

export const seatOf = (room, ref) => {
  if (typeof ref !== 'string' || ref === '') return null
  for (const [seat, memberRef] of Object.entries(room?.seatBots ?? {})) {
    if (memberRef === ref) return seat
  }
  return null
}

export const parseVerdict = reply => {
  const first = String(reply ?? '')
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '') ?? ''
  const head = first
    .replace(/^[*#>\s]+/, '')
    .replace(/^(结论|判定|验收结论|verdict)\s*[:：]?\s*/i, '')
  // 模型不一定把 PASS 放在行首；只读第一行，先认退回，再认通过。
  if (/(REJECT|不通过|未通过|无法通过|不能通过|没有通过|退回|打回|拒绝|失败)/i.test(head)) return false
  return /(PASS|通过|接受|同意)/i.test(head)
}

export const tail = (text, limit) => {
  const value = String(text ?? '')
  return value.length > limit ? `…\n${value.slice(-limit)}` : value
}

export const REVIEW_TIMEOUT = 10 * 60_000
export const REVIEW_REMINDER = 2 * 60_000
export const PARALLEL_TIMEOUT = 15 * 60_000
