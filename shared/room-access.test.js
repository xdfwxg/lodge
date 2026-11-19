import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ROOM_ACCESS,
  ROOM_ACCESS_OPTIONS,
  isBrowserTool,
  isReadOnlyResearchTool,
  parseRoomAccess,
  roomAccessFromBrowser,
  roomAccessOf,
} from './room-access.js'

test('a room has exactly two access modes', () => {
  assert.deepEqual(ROOM_ACCESS_OPTIONS.map(option => option.value), ['ask', 'allow'])
  assert.deepEqual(ROOM_ACCESS_OPTIONS.map(option => option.label), ['每次确认', '房间免确认'])
  assert.equal(roomAccessOf({}), ROOM_ACCESS.ASK)
  assert.equal(roomAccessOf({ roomAccess: 'allow' }), ROOM_ACCESS.PUBLIC_WEB)
  assert.equal(roomAccessFromBrowser(true), ROOM_ACCESS.PUBLIC_WEB)
  assert.equal(roomAccessFromBrowser(false), ROOM_ACCESS.ASK)
})

test('unknown access values are refused instead of guessed', () => {
  assert.equal(parseRoomAccess('allow'), ROOM_ACCESS.PUBLIC_WEB)
  assert.equal(parseRoomAccess('ask'), ROOM_ACCESS.ASK)
  assert.equal(parseRoomAccess('everything'), null)
})

test('only browser MCP tools are recognized as browser work', () => {
  assert.equal(isBrowserTool('mcp__chrome-devtools__navigate_page'), true)
  assert.equal(isBrowserTool('Bash'), false)
  assert.equal(isBrowserTool('mcp__lodge_gate__submit_verdict'), false)
})

test('read-only research covers browser, search and fetch, but not commands', () => {
  assert.equal(isReadOnlyResearchTool('mcp__chrome-devtools__take_snapshot'), true)
  assert.equal(isReadOnlyResearchTool('WebSearch'), true)
  assert.equal(isReadOnlyResearchTool('WebFetch'), true)
  assert.equal(isReadOnlyResearchTool('Bash'), false)
  assert.equal(isReadOnlyResearchTool('Write'), false)
})
