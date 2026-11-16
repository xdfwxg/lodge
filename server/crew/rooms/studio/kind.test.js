import assert from 'node:assert/strict'
import test from 'node:test'
import { roomKinds } from '../kinds.js'

const fallback = {
  worker: { requested: 'codex-cli', actual: 'claude', reason: 'missing' },
}

const messageOf = independence => roomKinds
  .find(kind => kind.id === 'studio')
  .initialMessages({
    room: { independence },
    workspaces: { environment: {} },
    engineFallbacks: fallback,
  })[0].text

test('a fallback that keeps a different verifier vendor stays independent', () => {
  const text = messageOf('vendor')
  assert.match(text, /实际跑的是 Claude/)
  assert.match(text, /仍由另一家模型独立复核/)
  assert.doesNotMatch(text, /不是独立复核/)
})

test('a same-vendor fallback says the review is not independent', () => {
  const text = messageOf('none')
  assert.match(text, /不是独立复核/)
})
