export const id = 'chat'
export const name = '聊天室'
export const description = '围绕一个话题讨论，随机唤醒发言，主持人总结后由你确认'
export const defaultVerify = 'manual'
export const readOnly = true
export const defaultSeats = [
  { role: 'lead', name: '主持人' },
  { role: 'worker', name: '甲' },
  { role: 'worker', name: '乙' },
]
export const autoStart = 'chat'
export const singleDirectory = true

export const normalize = () => ({ verify: 'manual', acceptance: '' })

export const buildStages = () => ({
  stages: [
    { title: '聊天讨论', kind: 'decision', state: 'active', readOnly: true },
    { title: '结论', kind: 'decision', state: 'pending', dependsOn: [0], readOnly: true },
  ],
  messages: ['聊天室：先讨论，达到发言上限后由主持人总结，最后你确认结论。'],
})
