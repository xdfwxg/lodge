import assert from 'node:assert/strict'
import test from 'node:test'
import { emailPresetOf } from './email-presets.js'

test('common providers fill host, port and TLS from the address', () => {
  const mail126 = emailPresetOf('nrt218@126.com')
  assert.equal(mail126.host, 'smtp.126.com')
  assert.equal(mail126.port, 465)
  assert.equal(mail126.secure, true)
  assert.equal(mail126.user, 'nrt218@126.com')
  assert.match(mail126.hint, /授权码/)

  const outlook = emailPresetOf('someone@outlook.com')
  assert.equal(outlook.host, 'smtp-mail.outlook.com')
  assert.equal(outlook.port, 587)
  assert.equal(outlook.secure, false)
})

test('the address is matched case-insensitively and trimmed', () => {
  assert.equal(emailPresetOf('  Someone@GMAIL.com ').host, 'smtp.gmail.com')
})

test('an unknown provider stays unknown instead of guessing', () => {
  assert.equal(emailPresetOf('me@example.com'), null)
  assert.equal(emailPresetOf('not-an-address'), null)
})
