import assert from 'node:assert/strict'
import test from 'node:test'
import { bodyCapabilitiesOf } from './body-capabilities.js'

const engine = (capabilities = {}) => ({ capabilities: { mcp: true, ...capabilities } })
const member = (over = {}) => ({
  permissions: { read: true, exec: true, write: true },
  body: { spec: { mcp: [] } },
  ...over,
})

test('a body exposes only what it can actually do', () => {
  assert.deepEqual(bodyCapabilitiesOf({
    engine: engine({ approvalReview: true, schedules: false }),
    member: member({
      permissions: { read: true, exec: true, write: true },
      body: { spec: { mcp: [{ server: 'chrome-devtools', scopes: ['read'] }] } },
    }),
    features: { skillsLibrary: true },
  }), {
    ask: true,
    read: true,
    tools: true,
    browser: true,
    skills: true,
    schedules: false,
  })
})

test('a read-only member exposes reading but not tools', () => {
  assert.deepEqual(bodyCapabilitiesOf({
    engine: engine(),
    member: member({ permissions: { read: true, exec: false, write: false } }),
    features: { skillsLibrary: true },
  }), {
    ask: false,
    read: true,
    tools: false,
    browser: false,
    skills: false,
    schedules: false,
  })
})

test('skills stay off when the base has no skills library', () => {
  assert.equal(bodyCapabilitiesOf({
    engine: engine(),
    member: member(),
    features: { skillsLibrary: false },
  }).skills, false)
})
