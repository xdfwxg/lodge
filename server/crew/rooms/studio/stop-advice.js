// 规划师说停只是建议：系统在没有进行中的执行和复核时才真正停，不打断正在跑的回合。
const IN_FLIGHT = new Set(['sent', 'working'])

export const stopAdviceReady = ({ assignments = [], reviewBusy = false } = {}) => (
  reviewBusy !== true &&
  !(Array.isArray(assignments) ? assignments : []).some(item => IN_FLIGHT.has(item?.status))
)
