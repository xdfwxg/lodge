import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFloorSignal, stripFloorSignal } from './floor-signal.js'

test('a floor signal is parsed and removed from the spoken text', () => {
  const floor = parseFloorSignal('我先说一句。\n[[lodge-floor {"action":"want"}]]')
  assert.equal(floor.action, 'want')
  assert.equal(floor.to, '')
  assert.equal(floor.text, '我先说一句。')
  assert.equal(stripFloorSignal('我先说一句。\n[[lodge-floor {"action":"pass","to":"乙"}]]'), '我先说一句。')
})

test('listen and pass carry their intent', () => {
  assert.equal(parseFloorSignal('[[lodge-floor {"action":"listen"}]]').action, 'listen')
  const pass = parseFloorSignal('我看乙更合适。\n[[lodge-floor {"action":"pass","to":"乙"}]]')
  assert.equal(pass.action, 'pass')
  assert.equal(pass.to, '乙')
  assert.equal(pass.text, '我看乙更合适。')
})

test('a broken signal is hidden instead of crashing', () => {
  const floor = parseFloorSignal('[[lodge-floor {not json}]]')
  assert.equal(floor.action, '')
  assert.equal(floor.text, '')
})
