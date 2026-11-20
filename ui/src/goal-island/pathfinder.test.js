import assert from 'node:assert/strict'
import test from 'node:test'
import { Pathfinder } from './pathfinder.js'

const line = (x0, y0, x1, y1, step, r) => {
  const out = []
  for (let t = 0; t <= 1.0001; t += step) out.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, r })
  return out
}

const assertWalkable = (pf, path) => {
  for (let i = 1; i < path.length; i++) assert.ok(pf.lineOfSight(path[i - 1], path[i]), `第 ${i} 段穿过了障碍`)
}

test('空地上的直线会被视线捷径拉直', () => {
  const pf = new Pathfinder()
  const { path, visited } = pf.find({ x: 50, y: 50 }, { x: 850, y: 450 })
  assert.ok(path.length >= 2 && path.length <= 3)
  assert.deepEqual(path[0], { x: 50, y: 50 })
  assert.deepEqual(path.at(-1), { x: 850, y: 450 })
  assert.ok(visited.length > 0)
  assertWalkable(pf, path)
})

test('一道石墙会逼它绕行，且每一段都不穿石', () => {
  const pf = new Pathfinder({ obstacles: line(450, 60, 450, 340, 40 / 280, 30) })
  const { path, visited } = pf.find({ x: 100, y: 250 }, { x: 800, y: 250 })
  assert.ok(path.length >= 3, '绕行应有转折')
  assert.ok(path.some(p => p.y > 390), '应从石墙下方绕过去')
  assert.ok(visited.length > 20)
  assertWalkable(pf, path)
})

test('目标落在石头里，会退到最近的可走格', () => {
  const pf = new Pathfinder({ obstacles: [{ x: 450, y: 250, r: 40 }] })
  const goal = { x: 450, y: 250 }
  const { path } = pf.find({ x: 120, y: 120 }, goal)
  assert.ok(path.length >= 2)
  const last = path.at(-1)
  assert.ok(Math.hypot(last.x - goal.x, last.y - goal.y) < 110)
  assert.ok(Math.hypot(last.x - goal.x, last.y - goal.y) > 20, '不该走进石头里')
  assertWalkable(pf, path)
})

test('被完全封死时如实返回空路径', () => {
  const pf = new Pathfinder({ obstacles: line(0, 250, 900, 250, 30 / 900, 26) })
  const { path } = pf.find({ x: 100, y: 100 }, { x: 800, y: 400 })
  assert.deepEqual(path, [])
})

test('重摆障碍后立刻按新地形重算', () => {
  const pf = new Pathfinder()
  const start = { x: 100, y: 250 }, goal = { x: 800, y: 250 }
  assert.ok(pf.find(start, goal).path.length <= 3)
  pf.obstacles = line(450, 60, 450, 340, 40 / 280, 30)
  pf.rebuild()
  assert.ok(pf.find(start, goal).path.some(p => p.y > 390))
})
