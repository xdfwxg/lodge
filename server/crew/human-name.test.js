import assert from 'node:assert/strict'
import test from 'node:test'
import { humanLabelOf, humanNameOf, setCurrentHumanName } from './human-name.js'

test('the global profile is the only source of the user name', () => {
  setCurrentHumanName('千寻')
  assert.equal(humanNameOf(), '千寻')
  assert.equal(humanLabelOf(), '千寻')
  setCurrentHumanName('')
  assert.equal(humanNameOf(), '')
  assert.equal(humanLabelOf(), '用户')
  assert.equal(humanLabelOf('你'), '你')
})

test('names are cleaned and capped like message labels', () => {
  setCurrentHumanName('  千寻  ')
  assert.equal(humanNameOf(), '千寻')
  setCurrentHumanName('一'.repeat(30))
  assert.equal(humanNameOf().length, 20)
  setCurrentHumanName('')
})
