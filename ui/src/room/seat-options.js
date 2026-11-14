// 席位名字、默认值和模型选项在聊天和工作室内共用；只做纯数据整形，不碰 React。
export const ROLE_LABEL = { lead: '规划师', worker: '执行官', verifier: '验收员', participant: '成员' }

export const normalizeSeats = seats => (Array.isArray(seats) ? seats : []).map(seat => ({
  role: seat.role,
  name: seat.name || ROLE_LABEL[seat.role] || seat.role,
  ...(typeof seat.reason === 'string' && seat.reason !== '' ? { reason: seat.reason } : {}),
  ...(seat.prompt ? { prompt: seat.prompt } : {}),
  ...(seat.station ? { station: seat.station } : {}),
  ...(seat.engine ? { engine: seat.engine } : {}),
  ...(seat.model ? { model: seat.model } : {}),
}))

export const seatChoicesFrom = seats => normalizeSeats(seats)
  .map(seat => ({ engine: seat.engine ?? '', model: seat.model ?? '' }))

export const modelRowsFor = engine => {
  if (engine === undefined) return []
  const seen = new Set()
  const rows = []
  const add = (id, label) => {
    if (typeof id !== 'string' || id === '' || seen.has(id)) return
    seen.add(id)
    rows.push({ id, label: typeof label === 'string' && label !== '' ? label : id })
  }
  for (const option of engine.models?.options ?? []) add(option?.id, option?.label)
  add(engine.models?.default, engine.models?.default)
  return rows
}
