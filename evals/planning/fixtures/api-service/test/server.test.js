import assert from 'node:assert/strict'
import test from 'node:test'
import { createHandler } from '../src/server.js'

test('handler answers with a JSON body', () => {
  let status = 0
  let body = ''
  createHandler()({ url: '/health' }, {
    writeHead: value => { status = value },
    end: value => { body = value },
  })
  assert.equal(status, 200)
  assert.deepEqual(JSON.parse(body), { ok: true, path: '/health' })
})
