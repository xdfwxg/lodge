// 只有不同厂商才叫独立复核；同一家模型一律按“自查”呈现。
export const independenceLabel = room => (
  room.independence === 'vendor'
    ? '独立复核'
    : room.independence === 'human' ? '你签字验收' : '模型自查'
)
