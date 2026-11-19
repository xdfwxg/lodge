import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canSkipApproval,
  grantBrowserToAll,
  hasBrowserGrant,
  needsBrowser,
  stripBrowser,
} from './room-access.js'

const grant = { server: 'chrome-devtools', scopes: ['read'], approval: 'ask' }
const member = (over = {}) => ({ id: 'member', role: 'worker', mcp: [], ...over })

test('every member gets the same read-only browser grant, once', () => {
  const roster = [member({ id: 'lead', role: 'lead' }), member({ id: 'worker' }), member({ id: 'verifier', role: 'verifier' })]
  const granted = grantBrowserToAll(roster)
  assert.equal(granted.every(item => hasBrowserGrant(item)), true)
  assert.equal(needsBrowser(granted), true)
  const again = grantBrowserToAll(granted)
  assert.equal(again.every(item => item.mcp.length === 1), true)
})

test('when the browser is not ready the grant is taken back, the room still opens', () => {
  const granted = grantBrowserToAll([member()])
  const stripped = stripBrowser(granted)
  assert.equal(stripped.every(item => item.mcp.length === 0), true)
  assert.equal(needsBrowser(stripped), false)
})

test('read-only research is system-approved; commands and writes still ask', () => {
  const withBrowser = grantBrowserToAll([member()])
  const worker = withBrowser[0]
  assert.equal(canSkipApproval({ member: worker, tool: 'mcp__chrome-devtools__navigate_page' }), true)
  assert.equal(canSkipApproval({ member: worker, tool: 'WebSearch' }), true)
  assert.equal(canSkipApproval({ member: worker, tool: 'WebFetch' }), true)
  assert.equal(canSkipApproval({ member: worker, tool: 'Bash' }), false)
  assert.equal(canSkipApproval({ member: worker, tool: 'Write' }), false)
  assert.equal(canSkipApproval({ member: member({ mcp: [grant] }), tool: 'Bash' }), false)
  assert.equal(canSkipApproval({ member: member(), tool: 'mcp__chrome-devtools__navigate_page' }), false)
})
