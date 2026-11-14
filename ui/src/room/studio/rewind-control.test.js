import assert from 'node:assert/strict'
import test from 'node:test'
import { rewindableStagesOf } from './rewind-control.js'

test('only passed deliverable stages with a recorded base can rewind', () => {
  const room = {
    stageBases: { 1: 'base-1' },
    stages: [
      { kind: 'decision', state: 'passed' },
      { kind: 'deliverable', state: 'passed' },
      { kind: 'deliverable', state: 'pending' },
      { kind: 'deliverable', state: 'passed' },
    ],
  }
  assert.deepEqual(rewindableStagesOf(room).map(item => item.index), [1])
  assert.deepEqual(rewindableStagesOf({ stages: [] }), [])
})
