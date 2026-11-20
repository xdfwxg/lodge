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
    assert.doesNotMatch(text, /\bwindow\.lodge/, `${rel(file)} bypasses the system bridge`)
  }
})

test('views receive the store instead of importing it', () => {
  const files = [...walk(join(root, 'views')), ...walk(join(root, 'room'))]
    .filter(path => path.endsWith('.js') && !path.endsWith('.test.js'))
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /from\s+['"][^'"]*store\.js['"]/, `${rel(file)} imports the transport store`)
  }
})

test('shared room modules never import a room kind', () => {
  const roomRoot = join(root, 'room')
  for (const file of walk(roomRoot)) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue
    if (relative(roomRoot, file).includes('/')) continue
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /from\s+['"][^'"]*room\/(chat|studio)\//, `${rel(file)} imports a room kind`)
  }
})

test('the new-room dialog composes kinds instead of importing studio', () => {
  const text = readFileSync(join(root, 'new-room-dialog.js'), 'utf8')
  assert.doesNotMatch(text, /from\s+['"][^'"]*room\/studio\//, 'new-room-dialog.js imports studio UI')
})

test('chat and studio UI contexts never import each other', () => {
  for (const file of walk(join(root, 'room/chat'))) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue
    assert.doesNotMatch(readFileSync(file, 'utf8'), /from\s+['"][^'"]*room\/studio\//, `${rel(file)} imports studio UI`)
  }
  for (const file of walk(join(root, 'room/studio'))) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue
    assert.doesNotMatch(readFileSync(file, 'utf8'), /from\s+['"][^'"]*room\/chat\//, `${rel(file)} imports chat UI`)
  }
})

test('shared UI modules do not branch on the room type', () => {
  for (const file of sourceFiles) {
    if (rel(file).startsWith('room/chat/') || rel(file).startsWith('room/studio/')) continue
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /\broom\??\.roomType\s*[!=]==?/, `${rel(file)} branches on room.roomType`)
  }
})

test('danger text uses the semantic text token', () => {
  for (const file of sourceFiles) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(
      text,
      /[{;]\s*color:\s*var\(--bt-danger\)/,
      `${rel(file)} paints danger text with the icon token`,
    )
  }
})

test('only the goal island may use blur, and no file uses the retired soft shadow', () => {
  for (const file of sourceFiles) {
    const text = readFileSync(file, 'utf8')
    if (rel(file) !== 'goal-island/surface.js') {
      assert.doesNotMatch(text, /backdrop-filter/, `${rel(file)} keeps a blur`)
    }
    assert.doesNotMatch(text, /--bt-shadow-soft/, `${rel(file)} uses the retired soft shadow`)
  }
})

test('app.js stays a composition shell', () => {
  const text = readFileSync(join(root, 'app.js'), 'utf8')
  for (const name of ['Sidebar', 'RoomView', 'DispatchView', 'NewRoomDialog']) {
    assert.doesNotMatch(text, new RegExp(`function\\s+${name}\\b`), `app.js still defines ${name}`)
  }
  for (const path of ['views/sidebar.js', 'views/room-view.js', 'new-room-dialog.js']) {
    assert.match(text, new RegExp(`from\\s+['"]\\./${path.replaceAll('/', '\\/')}['"]`), `app.js does not import ${path}`)
  }
})

test('views do not keep local storage', () => {
  for (const file of walk(join(root, 'views'))) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\blocalStorage\b/, `${rel(file)} touches local storage`)
  }
})

test('shared CSS does not branch on the room type', () => {
  for (const file of ['app.css', 'crew.css']) {
    const text = readFileSync(join(root, file), 'utf8')
    assert.doesNotMatch(text, /\bdata-mode=(?:studio|chat)\b/, `${file} branches on a room type`)
  }
})

test('shared presentation never imports a room mode', () => {
  const shared = [
    'message-cards.js',
    'approval-card.js',
    'room/message-view.js',
    'room/timeline-model.js',
    'room/decision.js',
  ]
  for (const file of shared) {
    const text = readFileSync(join(root, file), 'utf8')
    assert.doesNotMatch(
      text,
      /from\s+['"][^'"]*room\/(chat|studio)\//,
      `${file} imports a room-specific module`,
    )
  }
})

test('the room shell never imports a room mode', () => {
  const text = readFileSync(join(root, 'views/room-view.js'), 'utf8')
  assert.doesNotMatch(
    text,
    /from\s+['"][^'"]*room\/(chat|studio)\//,
    'views/room-view.js imports a room-specific module',
  )
})
