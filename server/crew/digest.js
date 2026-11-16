export const independenceLabel = room => (
  room.independence === 'vendor'
    ? '独立复核'
    : room.independence === 'model'
      ? '同一家模型复核，独立性有限'
      : room.independence === 'human' ? '你签字验收' : '复核独立性有限'
)
