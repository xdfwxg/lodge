import assert from 'node:assert/strict'
import test from 'node:test'
import { createSettingsStore } from '../backend/store.js'
import { saveSettings } from '../backend/server.js'
import { DEFAULT_SETTINGS, settingsPayload, validateSettings } from '../frontend/app.js'

test('frontend payload fills defaults and validates theme', () => {
  assert.deepEqual(settingsPayload({ theme: 'dark' }), {
    theme: 'dark',
    density: 'comfortable',
    notifications: true,
  })
  assert.equal(validateSettings({ theme: 'dark' }).ok, true)
  assert.equal(validateSettings({ theme: 'neon' }).ok, false)
})

test('backend store saves and reads settings', () => {
  const store = createSettingsStore()
  const saved = saveSettings({ theme: 'dark', density: 'compact' }, store)
  assert.equal(saved.theme, 'dark')
  assert.deepEqual(store.read(), { ...DEFAULT_SETTINGS, theme: 'dark', density: 'compact' })
})
