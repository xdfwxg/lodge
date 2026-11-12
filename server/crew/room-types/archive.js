export const id = 'archive'
export const name = '存档房'
export const description = '不执行代码，保存房间记录、结论与交接包'
export const defaultVerify = 'manual'
export const defaultSeats = [{ role: 'worker', name: '档案' }]
export const autoStart = 'none'

export const normalize = () => ({ verify: 'manual', acceptance: '' })

export const buildStages = () => ({
  stages: [{ title: '存档与交接', kind: 'decision', state: 'active' }],
  messages: ['存档房：不执行代码；确认后归档房间记录，可导出交接包。'],
})
