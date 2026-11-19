import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canSkipApproval,
  grantBrowserToFirstWorker,
  hasBrowserGrant,
  needsBrowser,
} from './room-access.js'

const grant = { server: 'chrome-devtools', scopes: ['read'], approval: 'ask' }
const worker = (over = {}) => ({ id: 'worker', role: 'worker', mcp: [], ...over })

test('a member grant can live on the member or its body spec', () => {
  assert.equal(hasBrowserGrant(worker({ mcp: [grant] })), true)
  assert.equal(hasBrowserGrant(worker({ body: { spec: { mcp: [grant] } } })), true)
  assert.equal(hasBrowserGrant(worker()), false)
})

test('only the first worker receives the browser grant, once', () => {
  const roster = [
    { id: 'lead', role: 'lead', mcp: [] },
    worker({ id: 'worker' }),
    worker({ id: 'worker-2' }),
  ]
  const granted = grantBrowserToFirstWorker(roster)
  assert.equal(granted[1].mcp[0].server, 'chrome-devtools')
  assert.deepEqual(granted[2].mcp, [])
  assert.equal(needsBrowser(granted), true)
  const again = grantBrowserToFirstWorker(granted)
  assert.equal(again[1].mcp.length, 1)
})

test('only a full-room member skips browser approval, and only for read-only research', () => {
  const room = { roomAccess: 'allow' }
  const member = worker({ body: { spec: { mcp: [grant] } } })
  assert.equal(canSkipApproval({ room, member, tool: 'mcp__chrome-devtools__navigate_page' }), true)
  assert.equal(canSkipApproval({ room, member, tool: 'WebSearch' }), true)
  assert.equal(canSkipApproval({ room, member, tool: 'WebFetch' }), true)
  assert.equal(canSkipApproval({ room: {}, member, tool: 'mcp__chrome-devtools__navigate_page' }), false)
  assert.equal(canSkipApproval({ room, member, tool: 'Bash' }), false)
  assert.equal(canSkipApproval({ room, member, tool: 'Write' }), false)
  assert.equal(canSkipApproval({ room, member: worker(), tool: 'mcp__chrome-devtools__navigate_page' }), false)
})
