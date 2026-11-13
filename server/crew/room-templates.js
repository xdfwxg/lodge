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

export const listRoomTemplates = () => ROOM_TEMPLATES.map(template => ({
  id: template.id,
  name: template.name,
  roomType: template.roomType,
  description: template.description,
  verify: template.verify,
  seats: template.seats.map(seat => ({ ...seat })),
  ...(template.rules === undefined ? {} : { rules: { ...template.rules } }),
}))
