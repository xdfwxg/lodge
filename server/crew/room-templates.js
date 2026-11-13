// 房间模板只是建房预设，不是新引擎；它帮助用户选对话还是交付。
export const ROOM_TEMPLATES = Object.freeze([
  {
    id: 'chat-roundtable',
    name: '圆桌聊天室',
    roomType: 'chat',
    description: '围绕一个话题自由讨论，主持人总结后由你拍板',
    verify: 'manual',
    seats: [
      { role: 'lead', name: '主持人' },
      { role: 'worker', name: '甲' },
      { role: 'worker', name: '乙' },
    ],
    rules: { turnsPerRound: 6 },
  },
  {
    id: 'studio-delivery',
    name: '开发工作室',
    roomType: 'studio',
    description: '有开工卡、执行、证据和 Verifier 的交付房间',
    verify: 'test',
    seats: [
      { role: 'lead', name: '规划师' },
      { role: 'worker', name: '执行者' },
      { role: 'verifier', name: '验收员' },
    ],
  },
  {
    id: 'studio-review',
    name: '评审工作室',
    roomType: 'studio',
    description: '人工验收交付物，但仍必须经过独立 Verifier',
    verify: 'manual',
    seats: [
      { role: 'lead', name: '规划师' },
      { role: 'worker', name: '执行者' },
      { role: 'verifier', name: '验收员' },
    ],
  },
])

const isId = value => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)

export const normalizeRoomTemplate = template => {
  if (!isId(template?.id)) throw new Error('房间模板 id 不可用')
  const name = typeof template.name === 'string' ? template.name.trim().slice(0, 60) : ''
  if (name === '') throw new Error('房间模板缺少名称')
  if (!['chat', 'studio'].includes(template.roomType)) throw new Error('房间模板房型不可用')
  if (!Array.isArray(template.seats) || template.seats.length === 0 || template.seats.length > 8) {
    throw new Error('房间模板需要 1–8 个席位')
  }
  const seats = template.seats.map(seat => {
    if (!['lead', 'worker', 'verifier'].includes(seat?.role)) throw new Error(`房间模板席位角色不可用：${seat?.role ?? ''}`)
    const seatName = typeof seat.name === 'string' ? seat.name.trim().slice(0, 32) : ''
    if (seatName === '') throw new Error('房间模板席位缺少名称')
    return { role: seat.role, name: seatName }
  })
  if (template.roomType === 'studio' && !seats.some(seat => seat.role === 'verifier')) {
    throw new Error('工作室模板必须包含验收席位')
  }
  return {
    id: template.id,
    name,
    roomType: template.roomType,
    description: typeof template.description === 'string' ? template.description.trim().slice(0, 200) : '',
    verify: template.verify === 'test' ? 'test' : 'manual',
    seats,
    ...(template.rules === undefined ? {} : { rules: { ...template.rules } }),
  }
}

export const mergeRoomTemplates = (custom = []) => {
  const byId = new Map(ROOM_TEMPLATES.map(template => [template.id, template]))
  for (const template of custom) byId.set(template.id, template)
  return [...byId.values()].map(template => ({
    id: template.id,
    name: template.name,
    roomType: template.roomType,
    description: template.description,
    verify: template.verify,
    seats: template.seats.map(seat => ({ ...seat })),
    ...(template.rules === undefined ? {} : { rules: { ...template.rules } }),
  }))
}

export const listRoomTemplates = (custom = []) => mergeRoomTemplates(custom)
