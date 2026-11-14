export const independenceLabel = room => (
  room.independence === 'vendor'
    ? '跨厂商复核'
    : room.independence === 'model'
      ? '同家族复核'
      : room.independence === 'human' ? '人签字验收（无独立复核）' : '独立性降级'
)
