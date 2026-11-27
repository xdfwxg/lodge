import assert from 'node:assert/strict'
import test from 'node:test'
import { packageArgs, packageLayout } from './package-layout.mjs'

test('a mac package carries the server, UI, rust base, runtime and license', () => {
  const layout = packageLayout({ app: '/app/Lodge.app' })
  assert.equal(layout.resources, '/app/Lodge.app/Contents/Resources')
  assert.equal(layout.binary, '/app/Lodge.app/Contents/MacOS/Lodge')
  assert.deepEqual(layout.required, [
    'app/server/index.js',
    'app/shared/system-policy.js',
    'app/ui/dist/index.html',
    'base-rs/lodge-base-slice',
    'runtimes/pi/pi',
    'licenses/third_party/OpenMausBot-LICENSE.txt',
  ])
})

test('arguments ignore a flag with no value', () => {
  assert.deepEqual(packageArgs([]), { app: 'release/mac-arm64/Lodge.app' })
  assert.deepEqual(packageArgs(['--app', '/tmp/Lodge.app']), { app: '/tmp/Lodge.app' })
  assert.deepEqual(packageArgs(['--app', '--gui']), { app: 'release/mac-arm64/Lodge.app' })
})
