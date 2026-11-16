import assert from 'node:assert/strict'
import test from 'node:test'
import { plainRuntimeError } from './base-error.js'

test('base errors become plain Chinese reasons', () => {
  assert.equal(
    plainRuntimeError(new Error('base 409 /api/groups/x: {"error":"this channel is working or waiting on you — finish that turn first"}')),
    '房间正在做事，等这一轮结束再试',
  )
  assert.equal(plainRuntimeError(new Error('base 403: forbidden: this change must come from the desktop app or a paired device')), '这个基座属于另一个桌面应用，Lodge 不能改它')
  assert.equal(plainRuntimeError(new Error('base 401 unauthorized')), '模型服务没有登录，先登录再试')
  assert.equal(plainRuntimeError(new Error('base 403 /api/bots')), '基座拒绝了这次操作')
  assert.equal(plainRuntimeError(new Error('base 404 /api/groups/x')), '基座里找不到对应的记录')
  assert.equal(plainRuntimeError(new Error('fetch failed')), '基座没有响应，稍后再试')
})

test('unknown errors keep their own message', () => {
  assert.equal(plainRuntimeError(new Error('磁盘满了')), '磁盘满了')
})
