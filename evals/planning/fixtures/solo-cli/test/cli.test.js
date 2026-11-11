import assert from 'node:assert/strict'
import test from 'node:test'
import { parseArgs } from '../src/cli.js'

test('parses --verbose', () => {
  assert.equal(parseArgs(['--verbose', 'run']).verbose, true)
  assert.deepEqual(parseArgs(['--verbose', 'run']).rest, ['run'])
})
