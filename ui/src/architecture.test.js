import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})
const sourceFiles = walk(root).filter(path => path.endsWith('.js') && !path.endsWith('.test.js'))
const rel = path => relative(root, path)

test('UI transport stays in store and system adapters', () => {
  for (const file of sourceFiles) {
    if (rel(file) === 'store.js' || rel(file) === 'system.js') continue
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /\bfetch\s*\(/, `${rel(file)} bypasses the transport boundary`)
    assert.doesNotMatch(text, /globalThis\.lodge/, `${rel(file)} bypasses the system bridge`)
  }
})

test('views receive the store instead of importing it', () => {
  const files = [...walk(join(root, 'views')), ...walk(join(root, 'room'))]
    .filter(path => path.endsWith('.js') && !path.endsWith('.test.js'))
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /from\s+['"][^'"]*store\.js['"]/, `${rel(file)} imports the transport store`)
  }
})

test('app.js stays a composition shell', () => {
  const text = readFileSync(join(root, 'app.js'), 'utf8')
  for (const name of ['Sidebar', 'RoomView', 'DispatchView', 'NewRoomDialog', 'Onboarding']) {
    assert.doesNotMatch(text, new RegExp(`function\\s+${name}\\b`), `app.js still defines ${name}`)
  }
  for (const path of ['views/sidebar.js', 'views/onboarding.js', 'views/room-view.js', 'new-room-dialog.js']) {
    assert.match(text, new RegExp(`from\\s+['"]\\./${path.replaceAll('/', '\\/')}['"]`), `app.js does not import ${path}`)
  }
})
