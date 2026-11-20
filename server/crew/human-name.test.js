import assert from 'node:assert/strict'
import test from 'node:test'
import { humanLabelOf, humanNameOf, setCurrentHumanName } from './human-name.js'

test('the global profile wins over an old per-room name', () => {
  setCurrentHumanName('千寻')
  assert.equal(humanNameOf({ humanName: '旧名字' }), '千寻')
  assert.equal(humanLabelOf({ humanName: '旧名字' }), '千寻')
  setCurrentHumanName('')
  assert.equal(humanNameOf({ humanName: '旧名字' }), '')
  assert.equal(humanLabelOf({ humanName: '旧名字' }), '用户')
})

test('before the global profile loads, an old room name is still readable', () => {
  setCurrentHumanName('', { loaded: false })
  assert.equal(humanNameOf({ humanName: '千寻' }), '千寻')
  assert.equal(humanNameOf({}), '')
})

test('names are cleaned and capped like message labels', () => {
  setCurrentHumanName('  千寻  ')
  assert.equal(humanNameOf({}), '千寻')
  setCurrentHumanName('一'.repeat(30))
  assert.equal(humanNameOf({}).length, 20)
})
