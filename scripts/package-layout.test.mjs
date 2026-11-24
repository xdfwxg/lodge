import assert from 'node:assert/strict'
import test from 'node:test'
import { packageArgs, packageLayout } from './package-layout.mjs'

test('a mac package carries the server, UI, base, runtime and license', () => {
  const layout = packageLayout({ platform: 'darwin', app: '/app/Lodge.app' })
  assert.equal(layout.mac, true)
  assert.equal(layout.resources, '/app/Lodge.app/Contents/Resources')
  assert.equal(layout.binary, '/app/Lodge.app/Contents/MacOS/Lodge')
  assert.deepEqual(layout.required, [
    'app/server/index.js',
    'app/shared/system-policy.js',
    'app/ui/dist/index.html',
    'base/dist-server/openmausbot.js',
    'runtimes/pi/pi',
    'licenses/third_party/OpenMausBot-LICENSE.txt',
  ])
})

test('windows packages use their own binary names and layout', () => {
  const layout = packageLayout({ platform: 'win32', app: 'C:\\Lodge' })
  assert.equal(layout.mac, false)
  assert.match(layout.binary, /Lodge\.exe$/)
  assert.ok(layout.required.includes('runtimes/pi/pi.exe'))
  assert.ok(!layout.required.includes('runtimes/pi/pi'))
})

test('arguments ignore a flag with no value', () => {
  assert.deepEqual(packageArgs([]), { app: 'release/mac-arm64/Lodge.app', platform: 'darwin' })
  assert.deepEqual(packageArgs(['--app', '/tmp/Lodge.app', '--platform', 'linux']), {
    app: '/tmp/Lodge.app',
    platform: 'linux',
  })
  assert.deepEqual(packageArgs(['--app', '--platform', 'win32']), {
    app: 'release/mac-arm64/Lodge.app',
    platform: 'win32',
  })
})
