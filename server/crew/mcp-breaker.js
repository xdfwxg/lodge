// MCP 熔断：按 server 统计失败窗口；熔断只暂停使用该 server 的席位回合。
export const MCP_FAILURE_LIMIT = 3
export const MCP_WINDOW_MS = 10 * 60_000

const normalize = (breaker, now) => {
  if (breaker === undefined || now - breaker.since > MCP_WINDOW_MS) {
    return { failures: 0, since: now, trippedAt: null }
  }
  return { failures: breaker.failures ?? 0, since: breaker.since ?? now, trippedAt: breaker.trippedAt ?? null }
}

export const recordMcpFailures = (breakers, calls, now = Date.now()) => {
  const next = { ...breakers }
  const tripped = []
  for (const call of calls) {
    if (typeof call?.server !== 'string' || call.server === '') continue
    const current = normalize(next[call.server], now)
    current.failures += Math.max(1, call.failed ?? 1)
    if (current.trippedAt === null && current.failures >= MCP_FAILURE_LIMIT) {
      current.trippedAt = now
      tripped.push(call.server)
    }
    next[call.server] = current
  }
  return { breakers: next, tripped }
}

export const trippedServers = room => (
  Object.entries(room?.mcpBreakers ?? {})
    .filter(([, breaker]) => breaker?.trippedAt !== null && breaker?.trippedAt !== undefined)
    .map(([server]) => server)
)

export const seatMcpServers = (room, seat) => (
  room?.seatSpecs?.find(item => item.id === seat)?.mcp?.map(grant => grant.server) ?? []
)

export const blockedSeats = room => (
  (room?.workers ?? []).filter(seat => seatMcpServers(room, seat).some(server => trippedServers(room).includes(server)))
)

export const resetMcpBreakers = (breakers, server = null) => {
  if (server === null) return {}
  const next = { ...breakers }
  delete next[server]
  return next
}
