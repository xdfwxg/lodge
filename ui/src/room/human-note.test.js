import assert from 'node:assert/strict'
import test from 'node:test'
import { humanNoteKey, humanNoteKeys, isDuplicateHumanRework } from './human-note.js'

test('a human rework marker is a duplicate only when its context record exists', () => {
  const marker = { kind: 'rework', authorId: 'you', text: '补一句', meta: { stage: 1 } }
  const context = { kind: 'human-context', authorId: 'you', text: '补一句', meta: { stage: 1 } }
  const keys = humanNoteKeys([context])
  assert.equal(humanNoteKey(marker), humanNoteKey(context))
  assert.equal(isDuplicateHumanRework(marker, keys), true)
  assert.equal(isDuplicateHumanRework(marker, humanNoteKeys([])), false)
})

test('a system or member rework is never hidden', () => {
  const keys = humanNoteKeys([{ kind: 'human-context', authorId: 'you', text: '补一句', meta: { stage: 1 } }])
  assert.equal(isDuplicateHumanRework({ kind: 'rework', authorId: 'system', text: '补一句', meta: { stage: 1 } }, keys), false)
  assert.equal(isDuplicateHumanRework({ kind: 'rework', authorId: 'planner', text: '补一句', meta: { stage: 1 } }, keys), false)
})

test('the same text on a different stage is not a match', () => {
  const keys = humanNoteKeys([{ kind: 'human-context', authorId: 'you', text: '补一句', meta: { stage: 1 } }])
  assert.equal(isDuplicateHumanRework({ kind: 'rework', authorId: 'you', text: '补一句', meta: { stage: 2 } }, keys), false)
})
