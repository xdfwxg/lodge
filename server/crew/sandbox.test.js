import assert from 'node:assert/strict'
import test from 'node:test'
import { runCommand } from './acceptance.js'
import { planCommand, registerSandboxProvider, sandboxCapability } from './sandbox.js'

test('network allow explicitly opts out of the sandbox', () => {
  const previous = process.env.CREW_ACCEPTANCE_NETWORK
  process.env.CREW_ACCEPTANCE_NETWORK = 'allow'
  try {
    assert.deepEqual(planCommand({ command: 'true' }), { file: '/bin/sh', args: ['-c', 'true'], mode: 'off' })
  } finally {
    if (previous === undefined) delete process.env.CREW_ACCEPTANCE_NETWORK
    else process.env.CREW_ACCEPTANCE_NETWORK = previous
  }
})

test('platform providers are pluggable and unknown platforms fail closed', () => {
  registerSandboxProvider('test-os', ({ command }) => ({
    file: '/bin/sh',
    args: ['-c', command],
    mode: 'test-network-deny',
  }))
  assert.equal(planCommand({ command: 'true', platform: 'test-os' }).mode, 'test-network-deny')
  assert.equal(sandboxCapability('test-os').supported, true)
  assert.equal(sandboxCapability('win32').supported, false)
  assert.match(planCommand({ command: 'true', platform: 'win32' }).error, /Windows/)
})

test('a sandboxed command runs, or fails closed when the platform has no primitive', async () => {
  const result = await runCommand({ command: 'printf sandbox-ok', cwd: '/tmp', sandbox: true })
  if (result.sandbox === 'unavailable') {
    assert.equal(result.exit, null)
    assert.match(result.output, /没有可用的网络隔离原语/)
    return
  }
  assert.equal(result.exit, 0)
  assert.equal(result.output, 'sandbox-ok')
  assert.equal(result.sandbox, 'network-deny')
})
