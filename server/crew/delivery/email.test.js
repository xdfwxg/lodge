import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  clearSmtpSettings,
  emailConfig,
  emailReady,
  saveSmtpSettings,
  smtpSettingsOf,
} from './email.js'

const withEnv = (values, run) => {
  const before = { ...process.env }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try { return run() } finally { process.env = before }
}

test('an smtp url becomes a transport without exposing the password', () => {
  withEnv({
    LODGE_SMTP_URL: 'smtp://me%40example.com:secret@mail.example.com:587',
    LODGE_EMAIL_FROM: 'me@example.com',
  }, () => {
    const config = emailConfig()
    assert.equal(config.from, 'me@example.com')
    assert.equal(config.transport.host, 'mail.example.com')
    assert.equal(config.transport.port, 587)
    assert.equal(config.transport.secure, false)
    assert.equal(config.transport.auth.user, 'me@example.com')
    assert.equal(config.transport.auth.pass, 'secret')
    assert.equal(config.transport.connectionTimeout, 15_000)
    assert.equal(config.transport.socketTimeout, 30_000)
  })
})

test('smtps uses implicit tls', () => {
  withEnv({
    LODGE_SMTP_URL: 'smtps://me%40example.com:secret@mail.example.com',
    LODGE_EMAIL_FROM: 'me@example.com',
  }, () => {
    assert.equal(emailConfig().transport.secure, true)
    assert.equal(emailConfig().transport.port, 465)
  })
})

test('the settings screen saves a private config and never sees the password back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-smtp-'))
  const path = join(dir, 'smtp.json')
  try {
    withEnv({
      LODGE_SMTP_CONFIG: path,
      LODGE_SMTP_URL: undefined,
      LODGE_EMAIL_FROM: undefined,
      LODGE_EMAIL_TO: undefined,
    }, () => {
      const saved = saveSmtpSettings({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        user: 'me@example.com',
        password: 'secret',
        from: 'me@example.com',
        to: 'me@example.com',
      })
      assert.equal(saved.settings.configured, true)
      assert.equal(saved.settings.host, 'smtp.example.com')
      assert.equal(saved.settings.user, 'me@example.com')
      assert.equal(JSON.stringify(saved.settings).includes('secret'), false)
      assert.equal(statSync(path).mode & 0o077, 0)
      assert.equal(emailConfig().transport.auth.pass, 'secret')
      assert.equal(smtpSettingsOf().to, 'me@example.com')
      const again = saveSmtpSettings({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        user: 'me@example.com',
        password: '',
        from: 'me@example.com',
        to: '',
      })
      assert.equal(again.settings.configured, true)
      assert.match(JSON.parse(readFileSync(path, 'utf8')).url, /secret/)
      const cleared = clearSmtpSettings()
      assert.equal(cleared.settings.configured, false)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a common provider fills the server from the address alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-smtp-'))
  const path = join(dir, 'smtp.json')
  try {
    withEnv({
      LODGE_SMTP_CONFIG: path,
      LODGE_SMTP_URL: undefined,
      LODGE_EMAIL_FROM: undefined,
      LODGE_EMAIL_TO: undefined,
    }, () => {
      const saved = saveSmtpSettings({ from: 'nrt218@126.com', password: 'secret', to: '' })
      assert.equal(saved.settings.configured, true)
      assert.equal(saved.settings.host, 'smtp.126.com')
      assert.equal(saved.settings.port, 465)
      assert.equal(saved.settings.secure, true)
      assert.equal(saved.settings.user, 'nrt218@126.com')
      assert.equal(emailConfig().transport.auth.user, 'nrt218@126.com')
      assert.equal(emailConfig().transport.auth.pass, 'secret')
      clearSmtpSettings()
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unknown provider without a host is refused instead of guessed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-smtp-'))
  const path = join(dir, 'smtp.json')
  try {
    withEnv({
      LODGE_SMTP_CONFIG: path,
      LODGE_SMTP_URL: undefined,
      LODGE_EMAIL_FROM: undefined,
      LODGE_EMAIL_TO: undefined,
    }, () => {
      const saved = saveSmtpSettings({ from: 'me@example.com', password: 'secret' })
      assert.match(saved.error, /没认出这家邮箱/)
      assert.equal(existsSync(path), false)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('changing the server without a password is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-smtp-'))
  const path = join(dir, 'smtp.json')
  try {
    withEnv({
      LODGE_SMTP_CONFIG: path,
      LODGE_SMTP_URL: undefined,
      LODGE_EMAIL_FROM: undefined,
    }, () => {
      saveSmtpSettings({
        host: 'smtp.example.com', port: 465, secure: true, user: 'me@example.com',
        password: 'secret', from: 'me@example.com', to: '',
      })
      const changed = saveSmtpSettings({
        host: 'other.example.com', port: 465, secure: true, user: 'me@example.com',
        password: '', from: 'me@example.com', to: '',
      })
      assert.match(changed.error, /重新填应用密码/)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('missing or invalid mail settings mean not ready', () => {
  // 本机可能已经接了自己的邮箱；这条用例只看「没有配置」时，不读真实文件。
  const emptyPath = join(tmpdir(), `lodge-smtp-missing-${process.pid}.json`)
  withEnv({ LODGE_SMTP_CONFIG: emptyPath, LODGE_SMTP_URL: undefined, LODGE_EMAIL_FROM: undefined }, () => {
    assert.equal(emailConfig(), null)
    assert.equal(emailReady(), false)
  })
  withEnv({ LODGE_SMTP_CONFIG: emptyPath, LODGE_SMTP_URL: 'https://example.com', LODGE_EMAIL_FROM: 'me@example.com' }, () => {
    assert.equal(emailConfig(), null)
  })
})
