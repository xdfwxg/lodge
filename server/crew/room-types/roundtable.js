export const id = 'roundtable'
export const name = '圆桌派队'
export const description = '平等讨论、评审、辩论，最后形成结论'
export const defaultVerify = 'manual'
export const defaultSeats = [
  { role: 'lead', name: '主持' },
  { role: 'worker', name: '甲' },
  { role: 'worker', name: '乙' },
]
export const autoStart = 'none'

export const normalize = () => ({ verify: 'manual', acceptance: '' })

export const buildStages = () => ({
  stages: [
    { title: '圆桌讨论', kind: 'decision', state: 'active' },
    { title: '结论', kind: 'decision', state: 'pending', dependsOn: [0] },
  ],
  messages: ['圆桌派队：先讨论，达成结论后由你确认。'],
})
