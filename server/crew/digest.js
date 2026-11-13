export const independenceLabel = room => (
  room.independence === 'vendor'
    ? '跨厂商复核'
    : room.independence === 'model'
      ? '同家族复核'
      : room.independence === 'human' ? '人签字验收（无独立复核）' : '独立性降级'
)

export const independencePolicyLabel = room => (
  room.independence === 'vendor'
    ? '跨厂商（执行与验收不同厂商）'
    : room.independence === 'model'
      ? '同家族（验收与执行同家族，复核强度低于跨厂商）'
      : room.independence === 'human'
        ? '无独立验收席位（你凭证据签字）'
        : room.independence === 'none' ? '单 CLI（验收与执行同引擎，独立性降级）' : '独立性未标注'
)
