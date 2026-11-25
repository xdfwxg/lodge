import assert from 'node:assert/strict'
import test from 'node:test'
import { loopbackOrigin, requestGuard } from './http-guard.js'

const request = (method, headers = {}) => ({ method, headers })

test('loopback hosts are accepted and external hosts are rejected', () => {
  assert.equal(requestGuard(request('GET', { host: '127.0.0.1:8787' })), null)
  assert.equal(requestGuard(request('GET', { host: 'localhost:8787' })), null)
  assert.equal(requestGuard(request('GET', { host: '[::1]:8787' })), null)
  assert.match(requestGuard(request('GET', { host: 'evil.com' })), /本机/)
  assert.match(requestGuard(request('GET', { host: '127.0.0.1.evil.com' })), /本机/)
  assert.match(requestGuard(request('GET', { host: '127.0.0.1:8787@evil.com' })), /本机/)
  assert.match(requestGuard(request('GET', {})), /本机/)
})

test('cross-site writes are rejected even when they carry no body', () => {
  assert.match(requestGuard(request('POST', {
    host: '127.0.0.1:8787',
    origin: 'https://evil.com',
  })), /跨站/)
  assert.match(requestGuard(request('POST', {
    host: '127.0.0.1:8787',
    origin: 'null',
  })), /跨站/)
  assert.equal(requestGuard(request('POST', {
    host: '127.0.0.1:8787',
    origin: 'http://localhost:5173',
  })), null)
  assert.equal(requestGuard(request('POST', {
    host: '127.0.0.1:8787',
  })), null)
})

test('write bodies must be JSON', () => {
  assert.match(requestGuard(request('POST', {
    host: '127.0.0.1:8787',
    'content-type': 'text/plain',
    'content-length': '12',
  })), /JSON/)
  assert.match(requestGuard(request('POST', {
    host: '127.0.0.1:8787',
    'content-type': 'application/x-www-form-urlencoded',
    'content-length': '12',
  })), /JSON/)
  assert.equal(requestGuard(request('POST', {
    host: '127.0.0.1:8787',
    'content-type': 'application/json; charset=utf-8',
    'content-length': '12',
  })), null)
  assert.equal(requestGuard(request('POST', {
    host: '127.0.0.1:8787',
    'content-type': 'text/plain',
  })), null)
})

test('desktop write actions need the one-time token; reads and uploads do not', () => {
  const token = 'one-time-token'
  assert.equal(requestGuard(request('GET', { host: '127.0.0.1:8787' }), '/api/state', { actionToken: token }), null)
  assert.match(requestGuard(request('POST', { host: '127.0.0.1:8787' }), '/api/rooms/room-1/approvals', { actionToken: token }), /Lodge 窗口/)
  assert.equal(requestGuard(request('POST', {
    host: '127.0.0.1:8787',
    'x-lodge-action': token,
  }), '/api/rooms/room-1/approvals', { actionToken: token }), null)
  assert.equal(requestGuard(request('POST', { host: '127.0.0.1:8787' }), '/api/attachments', { actionToken: token }), null)
  assert.equal(requestGuard(request('POST', { host: '127.0.0.1:8787' }), '/api/rooms', { actionToken: null }), null)
})

test('only loopback http origins count', () => {
  assert.equal(loopbackOrigin('http://127.0.0.1:5173'), true)
  assert.equal(loopbackOrigin('https://localhost:5173'), true)
  assert.equal(loopbackOrigin('file://'), false)
  assert.equal(loopbackOrigin('https://evil.com'), false)
  assert.equal(loopbackOrigin('http://localhost.evil.com'), false)
})
