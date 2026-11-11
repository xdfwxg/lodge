import assert from 'node:assert/strict'
import test from 'node:test'
import { runCommand } from './acceptance.js'
import { createWindowsSandboxProvider, planCommand, registerSandboxProvider, sandboxCapability } from './sandbox.js'

test('network allow explicitly opts out of the sandbox', () => {
  const previous = process.env.CREW_ACCEPTANCE_NETWORK
  process.env.CREW_ACCEPTANCE_NETWORK = 'allow'
  try {
    const plan = planCommand({ command: 'true' })
    assert.equal(plan.file, '/bin/sh')
    assert.deepEqual(plan.args, ['-c', 'true'])
    assert.equal(plan.mode, 'off')
    assert.equal(plan.network, 'allow')
  } finally {
    if (previous === undefined) delete process.env.CREW_ACCEPTANCE_NETWORK
    else process.env.CREW_ACCEPTANCE_NETWORK = previous
  }
})

test('network allow still uses a Windows shell when the platform is Windows', () => {
  const plan = planCommand({ command: 'npm test', network: 'allow', platform: 'win32' })
  assert.equal(plan.mode, 'off')
  assert.match(plan.file, /(?:cmd|ComSpec)/i)
  assert.deepEqual(plan.args.slice(-1), ['npm test'])
})

test('the Windows provider uses WSL bubblewrap for network and filesystem isolation', () => {
  const provider = createWindowsSandboxProvider({
    hasCommand: name => name === 'wsl.exe',
    probe: args => args.includes('bwrap') && args.includes('--unshare-net'),
  })
  const plan = provider({ command: 'npm test' })
  assert.equal(plan.mode, 'wsl-network-fs-deny')
  assert.equal(plan.network, 'deny')
  assert.equal(plan.fs, 'cwd')
  assert.equal(plan.file, 'wsl.exe')
  assert.match(plan.args.at(-3), /bwrap/)
  assert.match(plan.args.at(-3), /--unshare-net/)
  assert.match(plan.args.at(-3), /--bind "\$PWD" "\$PWD"/)
  assert.equal(plan.args.at(-1), 'npm test')
})

test('the Windows provider fails closed without WSL or bubblewrap', () => {
  const noWsl = createWindowsSandboxProvider({ hasCommand: () => false })
  assert.equal(noWsl({ command: 'true' }).mode, 'unavailable')
  assert.match(noWsl({ command: 'true' }).error, /WSL2/)

  const noBwrap = createWindowsSandboxProvider({
    hasCommand: () => true,
    probe: () => false,
  })
  assert.equal(noBwrap({ command: 'true' }).mode, 'unavailable')
  assert.match(noBwrap({ command: 'true' }).error, /bubblewrap/)
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
