import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loginEntry, loginScript, safeRuntimeId, shellQuote } from './runtime-login.mjs'

const temp = () => mkdtempSync(join(tmpdir(), 'lodge-login-'))

test('values are single-quoted for the shell, including quotes', () => {
  assert.equal(shellQuote('claude'), "'claude'")
  assert.equal(shellQuote("a'b"), "'a'\\''b'")
})

test('a login script asks for a provider only when the template needs one', () => {
  const plain = loginScript({
    login: { args: ['login', '--flag', "it's"] },
    binary: '/bin/claude',
  })
  assert.match(plain.text, /^#!\/bin\/zsh\nclear\n/)
  assert.match(plain.text, /'\/bin\/claude' 'login' '--flag' 'it'\\''s'/)
  assert.doesNotMatch(plain.text, /read provider/)
  assert.equal(plain.file, 'runtime-login.command')

  const provider = loginScript({
    login: { instanceId: 'pi', args: ['login', '--provider', '{provider}'], prompt: 'vendor: ' },
    binary: 'pi',
    note: 'done',
  })
  assert.match(provider.text, /read provider/)
  assert.match(provider.text, /'--provider' "\$provider"/)
  assert.match(provider.text, /'done'/)
  assert.equal(provider.file, 'pi-login.command')
})

test('an empty or unknown login never produces a script', () => {
  assert.equal(loginScript({ login: { args: [] }, binary: '/bin/claude' }), null)
  assert.equal(loginScript({ login: { args: ['login'] }, binary: '' }), null)
  assert.equal(safeRuntimeId('../../etc/passwd'), '______etc_passwd')
})

test('login entries pick a folder on other platforms and a script on macOS', () => {
  const root = temp()
  try {
    const runtime = join(root, 'pi')
    mkdirSync(runtime)
    writeFileSync(join(runtime, 'pi'), '#!/bin/sh\n')
    const instance = {
      instanceId: 'pi',
      login: { args: ['login'], command: 'pi' },
      cliCandidates: [],
    }
    assert.deepEqual(loginEntry({
      instance,
      bundled: { dir: runtime, binaryPath: join(runtime, 'pi') },
      platform: 'linux',
      userDataDir: root,
    }), { kind: 'folder', path: runtime })

    const mac = loginEntry({
      instance,
      bundled: { dir: runtime, binaryPath: join(runtime, 'pi') },
      platform: 'darwin',
      userDataDir: root,
    })
    assert.equal(mac.kind, 'script')
    assert.equal(mac.file, join(root, 'pi-login.command'))
    assert.match(mac.text, /\/pi' 'login'/)

    assert.equal(loginEntry({
      instance: { instanceId: 'evil', login: { args: ['login'], command: '/bin/sh' }, cliCandidates: [] },
      bundled: null,
      platform: 'darwin',
      userDataDir: root,
    }), null)
    assert.equal(loginEntry({ instance: { instanceId: 'pi', login: { args: [] } }, platform: 'darwin', userDataDir: root }), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
