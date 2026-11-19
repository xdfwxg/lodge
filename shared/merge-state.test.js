import assert from 'node:assert/strict'
import test from 'node:test'
import { MERGE_STATE, mergeStateOf } from './merge-state.js'

test('a conflict is a state, not a loose field', () => {
  const state = mergeStateOf({
    mergeConflict: { stage: 1, files: ['src/a.js'], versions: [{ path: 'src/a.js' }] },
  })
  assert.equal(state.state, MERGE_STATE.CONFLICT)
  assert.equal(state.stage, 1)
  assert.deepEqual(state.files, ['src/a.js'])
  assert.equal(state.versions.length, 1)
})

test('merging comes before conflict and resolved after it', () => {
  assert.equal(mergeStateOf({ mergeInProgress: { stage: 0 } }).state, MERGE_STATE.MERGING)
  assert.equal(mergeStateOf({ mergeResolved: { stage: 0 } }).state, MERGE_STATE.RESOLVED)
  assert.equal(mergeStateOf({}).state, MERGE_STATE.NONE)
})

test('a stage asks only about its own merge', () => {
  const room = { mergeConflict: { stage: 1, files: ['b'] } }
  assert.equal(mergeStateOf(room, 0).state, MERGE_STATE.NONE)
  assert.equal(mergeStateOf(room, 1).state, MERGE_STATE.CONFLICT)
})
