import assert from 'node:assert/strict'
import test from 'node:test'
import { API_ROUTES, matchRoute, routeKey } from './api-contract.js'
import { HTTP_HANDLER_KEYS } from './http.js'
import { ROOM_ACTIONS } from './route-table.js'

const routeFor = (method, path) => API_ROUTES.find(route => route.method === method && route.path === path)

test('the protocol drives the transport: every declared route has a handler, and nothing else does', () => {
  // http.js 按这张表分派；漏一个处理函数或写下表里没有的接口，模块加载时就会抛。
  assert.deepEqual([...HTTP_HANDLER_KEYS].sort(), API_ROUTES.map(routeKey).sort())
})

test('the contract answers what each surface needs: 界面、桌面壳、探活、评测', () => {
  for (const [method, path] of [
    ['GET', '/api/state'],
    ['GET', '/api/events'],
    ['GET', '/api/health'],
    ['GET', '/api/ping'],
    ['POST', '/api/rooms'],
  ]) {
    assert.notEqual(routeFor(method, path), undefined, `协议里缺 ${method} ${path}`)
  }
  // 探活必须能不鉴权地问：主进程和监听自检都靠它。
  assert.equal(routeFor('GET', '/api/ping').auth, 'none')
  assert.equal(routeFor('GET', '/api/events').kind, 'events')
})

test('paths and parameters are matched from the same table', () => {
  assert.deepEqual(matchRoute(routeFor('GET', '/api/state'), '/api/state'), {})
  assert.equal(matchRoute(routeFor('GET', '/api/state'), '/api/health'), null)
  assert.deepEqual(
    matchRoute(routeFor('POST', '/api/rooms/:roomId/memory/:memoryId/review'), '/api/rooms/room-1/memory/m-2/review'),
    { roomId: 'room-1', memoryId: 'm-2' },
  )
  // 不认识的动作仍然 404：通用动作路由只认 ROOM_ACTIONS 里的名字。
  assert.equal(matchRoute(routeFor('POST', '/api/rooms/:roomId/:action'), '/api/rooms/room-1/nope'), null)
  for (const action of ROOM_ACTIONS) {
    assert.deepEqual(
      matchRoute(routeFor('POST', '/api/rooms/:roomId/:action'), `/api/rooms/room-1/${action}`),
      { roomId: 'room-1', action },
    )
  }
})

test('each route says how it answers and who may call it', () => {
  const seen = new Set()
  for (const route of API_ROUTES) {
    assert.match(route.method, /^(GET|POST)$/, `${route.path} 的方法`)
    assert.match(route.kind, /^(json|events|bytes|static)$/, `${route.path} 的回应形状`)
    assert.match(route.auth, /^(none|token|room)$/, `${route.path} 的鉴权口径`)
    const key = routeKey(route)
    assert.equal(seen.has(key), false, `重复的接口：${key}`)
    seen.add(key)
  }
})
