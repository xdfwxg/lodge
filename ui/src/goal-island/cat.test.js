import assert from 'node:assert/strict'
import test from 'node:test'
import { pointOnRim } from './cat.js'

const near = (actual, expected, name) => {
  assert.ok(Math.abs(actual - expected) < 0.01, `${name}: ${actual} != ${expected}`)
}
const angle = value => ((value % 360) + 360) % 360

test('the cat walks the top edge to the right', () => {
  const point = pointOnRim(0, 400, 54)
  near(point.x, 27, 'x')
  near(point.y, 0, 'y')
  near(angle(point.angle), 0, 'angle')
  const mid = pointOnRim(50, 400, 54)
  near(mid.x, 77, 'mid x')
  near(mid.y, 0, 'mid y')
})

test('the rim turns down the right end, under the island and up the left', () => {
  const top = 400 - 27 * 2
  const arc = Math.PI * 27 / 2
  const right = pointOnRim(top + arc, 400, 54)
  near(right.x, 400, 'right x')
  near(right.y, 27, 'right y')
  near(angle(right.angle), 90, 'right angle')
  const bottom = pointOnRim(top + arc * 2, 400, 54)
  near(bottom.x, 373, 'bottom x')
  near(bottom.y, 54, 'bottom y')
  near(angle(bottom.angle), 180, 'bottom angle')
  const left = pointOnRim(top * 2 + arc * 3, 400, 54)
  near(left.x, 0, 'left x')
  near(left.y, 27, 'left y')
  near(angle(left.angle), 270, 'left angle')
  const loop = pointOnRim(top * 2 + arc * 4, 400, 54)
  near(loop.x, 27, 'loop x')
  near(loop.y, 0, 'loop y')
})

test('a tall open panel keeps straight sides on its way around', () => {
  const point = pointOnRim(0, 560, 320)
  near(point.x, 30, 'x')
  const side = pointOnRim(560 - 60 + Math.PI * 30 / 2, 560, 320)
  near(side.x, 560, 'side x')
  near(side.y, 30, 'side y')
  near(angle(side.angle), 90, 'side angle')
})
