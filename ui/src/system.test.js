import assert from 'node:assert/strict'
import test from 'node:test'
import { onCommand } from './system.js'

test('desktop commands reach the renderer handler', () => {
  const previous = globalThis.lodge
  const seen = []
  let stop = null
  globalThis.lodge = {
    onCommand: handler => {
      stop = () => handler('new-room')
      return () => { stop = null }
    },
  }
  const off = onCommand(command => seen.push(command))
  stop?.()
  off?.()
  assert.deepEqual(seen, ['new-room'])
  assert.equal(stop, null)
  globalThis.lodge = previous
})
