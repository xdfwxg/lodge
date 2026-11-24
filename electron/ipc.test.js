import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openPath, runtimeLogin } from './ipc.mjs'

const baseReply = instances => async () => ({ json: async () => ({ instances }) })

test('runtime login validates the id and the base connection first', async () => {
  let opened = null
  assert.deepEqual(await runtimeLogin({ id: '../shell', baseUrl: 'http://base', open: () => { opened = true } }), {
    ok: false,
    error: '未知 runtime',
  })
  assert.deepEqual(await runtimeLogin({ id: 'claude', baseUrl: '', open: () => { opened = true } }), {
    ok: false,
    error: '基座还没有连接',
  })
  assert.equal(opened, null)
})

test('runtime login reports a missing engine and an engine without a login', async () => {
  assert.deepEqual(await runtimeLogin({
    id: 'claude',
    baseUrl: 'http://base',
    fetchImpl: baseReply([]),
    open: () => {},
  }), { ok: false, error: '没有 claude 这个引擎' })

  assert.deepEqual(await runtimeLogin({
    id: 'claude',
    baseUrl: 'http://base',
    fetchImpl: baseReply([{ instanceId: 'claude', displayName: 'Claude', login: { args: [] } }]),
    open: () => {},
  }), { ok: false, error: 'Claude 没有配置终端登录' })
})

test('runtime login opens the engine when the base offers a login', async () => {
  const opened = []
  const result = await runtimeLogin({
    id: 'claude',
    baseUrl: 'http://base',
    fetchImpl: baseReply([{ instanceId: 'claude', displayName: 'Claude', login: { args: ['login'] } }]),
    open: instance => opened.push(instance.instanceId),
  })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(opened, ['claude'])
})

test('a base failure comes back as a readable error, not a throw', async () => {
  assert.deepEqual(await runtimeLogin({
    id: 'claude',
    baseUrl: 'http://base',
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED') },
    open: () => {},
  }), { ok: false, error: 'connect ECONNREFUSED' })
})

test('opening a path refuses what the shared policy refuses', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-ipc-'))
  try {
    const text = join(root, 'notes.md')
    const script = join(root, 'run.command')
    writeFileSync(text, '# notes\n')
    writeFileSync(script, '#!/bin/sh\n')
    const opened = []
    assert.deepEqual(await openPath(text, { open: path => { opened.push(path); return '' } }), { ok: true })
    assert.deepEqual(opened, [text])

    const denied = await openPath(script, { open: path => { opened.push(path); return '' } })
    assert.equal(denied.ok, false)
    assert.equal(opened.length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an open failure is reported instead of pretending it opened', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-ipc-fail-'))
  try {
    const text = join(root, 'notes.md')
    writeFileSync(text, '# notes\n')
    assert.deepEqual(await openPath(text, { open: async () => 'permission denied' }), {
      ok: false,
      error: 'permission denied',
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
