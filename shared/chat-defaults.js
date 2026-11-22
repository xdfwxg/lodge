// 聊天室默认成员：建房界面和后端共用一份，避免界面显示“空成员”而实际开出三个人。
export const DEFAULT_CHAT_MEMBERS = Object.freeze([
  { role: 'worker', name: '甲', personality: 'assertive', stance: 'proposer', voice: '先问代价，再问能不能落地。' },
  { role: 'worker', name: '乙', personality: 'cheerful', stance: 'critic', voice: '先找边界，再问会不会坏。' },
  { role: 'worker', name: '丙', personality: 'gentle', stance: 'synthesizer', voice: '先看取舍，再问怎么收口。' },
])
