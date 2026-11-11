import assert from 'node:assert/strict'
import test from 'node:test'
import { blockedSeats, MCP_WINDOW_MS, recordMcpFailures, resetMcpBreakers, trippedServers } from './mcp-breaker.js'

const room = breakers => ({
  workers: ['甲', '乙'],
  seatSpecs: [
    { id: '甲', mcp: [{ server: 'github' }] },
    { id: '乙', mcp: [{ server: 'linear' }] },
  ],
  mcpBreakers: breakers,
})

test('a server trips after three failures in the window and blocks only its seats', () => {
  const now = 1_000_000
  let result = recordMcpFailures({}, [{ server: 'github', failed: 2 }], now)
  assert.deepEqual(result.tripped, [])
  result = recordMcpFailures(result.breakers, [{ server: 'github', failed: 1 }], now + 1_000)
  assert.deepEqual(result.tripped, ['github'])
  assert.deepEqual(trippedServers({ mcpBreakers: result.breakers }), ['github'])
  assert.deepEqual(blockedSeats(room(result.breakers)), ['甲'])
})

test('a new window forgets old failures and reset clears a breaker', () => {
  const now = 1_000_000
  const first = recordMcpFailures({}, [{ server: 'github', failed: 3 }], now).breakers
  const later = recordMcpFailures(first, [{ server: 'github', failed: 1 }], now + MCP_WINDOW_MS + 1)
  assert.deepEqual(later.tripped, [])
  assert.deepEqual(resetMcpBreakers(first, 'github'), {})
})
