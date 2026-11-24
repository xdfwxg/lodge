import assert from 'node:assert/strict'
import test from 'node:test'
import { navigationTarget, windowOptions } from './navigation.mjs'

const origin = 'http://127.0.0.1:8787'

test('the window stays on its own origin', () => {
  assert.deepEqual(navigationTarget(`${origin}/rooms/1`, origin), { action: 'allow' })
  assert.deepEqual(navigationTarget('https://example.com/a', origin), { action: 'external', url: 'https://example.com/a' })
  assert.deepEqual(navigationTarget('javascript:alert(1)', origin), { action: 'deny' })
  assert.deepEqual(navigationTarget('file:///etc/passwd', origin), { action: 'deny' })
  assert.deepEqual(navigationTarget('http://127.0.0.1:9999/x', origin), { action: 'external', url: 'http://127.0.0.1:9999/x' })
  assert.deepEqual(navigationTarget('bad url', origin), { action: 'deny' })
})

test('the renderer has no node access, even in development', () => {
  const options = windowOptions({ platform: 'darwin', packaged: false, iconFile: '', preload: '/app/preload.cjs' })
  assert.equal(options.webPreferences.contextIsolation, true)
  assert.equal(options.webPreferences.nodeIntegration, false)
  assert.equal(options.webPreferences.sandbox, true)
  assert.equal(options.webPreferences.devTools, true)
  assert.equal(options.preload, undefined)
  assert.equal(options.webPreferences.preload, '/app/preload.cjs')
})

test('a packaged build turns devtools off and only non-mac builds take an icon', () => {
  const packaged = windowOptions({ platform: 'darwin', packaged: true, iconFile: '/icon.png', preload: '/p.cjs' })
  assert.equal(packaged.webPreferences.devTools, false)
  assert.equal(packaged.icon, undefined)
  assert.equal(packaged.titleBarStyle, 'hiddenInset')

  const win = windowOptions({ platform: 'win32', packaged: true, iconFile: '/icon.png', preload: '/p.cjs' })
  assert.equal(win.icon, '/icon.png')
  assert.equal(win.titleBarStyle, 'default')
})
