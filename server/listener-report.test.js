// 现场快照要在「监听已经死了、但我们还不知道为什么」的时候还能写成：
// 文件齐、状态对、写失败不抛错、也不挡住后面的重建。
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureListenerReport } from './listener-report.js'

test('a lost listener leaves a report, an lsof dump and the server state', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lodge-report-'))
  const logs = []
  try {
    const server = { listening: true, address: () => ({ address: '127.0.0.1', port: 8788, family: 'IPv4' }), _handle: { fd: 19 } }
    const result = await captureListenerReport({ dataDir, port: 8788, server, at: 1_700_000_000_000, log: message => logs.push(message) })
    assert.notEqual(result, null)
    assert.equal(existsSync(join(dataDir, 'logs', 'listener-lost-1700000000000.report.json')), true)
    assert.equal(existsSync(join(dataDir, 'logs', 'listener-lost-1700000000000.state.json')), true)
    const state = JSON.parse(readFileSync(join(dataDir, 'logs', 'listener-lost-1700000000000.state.json'), 'utf8'))
    // 故障核心：内核已经不接客，JS 这边还在说自己在听，fd 也还挂着。
    assert.equal(state.listening, true)
    assert.equal(state.handleFd, 19)
    assert.equal(state.port, 8788)
    assert.equal(state.pid, process.pid)
    assert.ok(Array.isArray(state.activeResources))
    assert.ok(logs.some(line => line.includes('监听丢失的现场已写到')))
    if (state.sockets !== undefined) {
      assert.ok(Number.isInteger(state.sockets.fds))
      assert.ok(Number.isInteger(state.sockets.established))
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('a snapshot that cannot be written says so and stays out of the way', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-report-blocked-'))
  const blocked = join(dir, 'not-a-dir')
  writeFileSync(blocked, 'x')
  const logs = []
  try {
    const result = await captureListenerReport({ dataDir: blocked, port: 8788, log: message => logs.push(message) })
    assert.equal(result, null)
    assert.ok(logs.some(line => line.includes('现场没能落盘')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
