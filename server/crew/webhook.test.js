// webhook 入口：令牌是这个入口唯一的门；同一个事件 id 只落一条；关掉之后整条路消失。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { SAMPLE_ROOM_ID } from './rooms/sample.js'
import { createCrewService } from './service.js'
import { createStore } from './store.js'
import { alreadyReceived, newWebhookToken, normalizeWebhookEvent, verifyWebhookToken } from './webhook.js'

const setup = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-webhook-'))
  const store = createStore({ dataDir })
  const service = createCrewService({
    store,
    engine: { health: async () => ({}), instances: async () => [] },
    live: { isAttached: () => false },
    emit: () => {},
    seats: [],
    ports: createCrewPorts(),
  })
  return { dataDir, store, service }
}

const call = (service, roomId, action, body) => service.roomRequest(roomId, action, {
  method: 'POST',
  readBody: async () => body,
})

const tokenOf = path => String(path ?? '').split('/').at(-1)

test('tokens are long, random and compared exactly', () => {
  const first = newWebhookToken()
  const second = newWebhookToken()
  assert.match(first, /^[a-f0-9]{48}$/)
  assert.notEqual(first, second)
  assert.equal(verifyWebhookToken({ webhook: { token: first } }, first), true)
  assert.equal(verifyWebhookToken({ webhook: { token: first } }, second), false)
  assert.equal(verifyWebhookToken({ webhook: { token: first } }, `${first.slice(1)}a`), false)
  assert.equal(verifyWebhookToken({}, first), false)
  assert.equal(verifyWebhookToken({ webhook: { token: first } }, ''), false)
})

test('an event keeps one sentence and one id, with sane limits', () => {
  assert.deepEqual(normalizeWebhookEvent({ text: '  构建失败了  ', id: 'ci-1' }), { text: '构建失败了', id: 'ci-1' })
  assert.equal(normalizeWebhookEvent({ text: '' }).error, '事件正文不能为空')
  assert.equal(normalizeWebhookEvent({ text: 'x'.repeat(4001) }).error, '事件正文最多 4000 字')
  assert.match(normalizeWebhookEvent({ text: 'ok' }).id, /^[0-9a-f-]{36}$/)
  assert.equal(alreadyReceived([{ meta: { webhookId: 'ci-1' } }], 'ci-1'), true)
  assert.equal(alreadyReceived([{ meta: { webhookId: 'ci-1' } }], 'ci-2'), false)
})

test('a room can open, use, rotate and close its webhook', async () => {
  const { dataDir, store, service } = setup()
  try {
    service.createSampleRoom('studio')
    const opened = await call(service, SAMPLE_ROOM_ID, 'webhook', { action: 'enable' })
    assert.equal(opened.ok, true)
    assert.match(opened.body.path, new RegExp(`^/api/webhooks/${SAMPLE_ROOM_ID}/[a-f0-9]{48}$`))
    const token = tokenOf(opened.body.path)

    // 同一个 id 投两次只落一条。
    const first = await service.webhookReceive(SAMPLE_ROOM_ID, token, { text: '构建失败了', id: 'ci-1' })
    assert.equal(first.ok, true)
    const duplicate = await service.webhookReceive(SAMPLE_ROOM_ID, token, { text: '构建失败了', id: 'ci-1' })
    assert.equal(duplicate.body.duplicate, true)
    const received = store.readMessages(SAMPLE_ROOM_ID).filter(message => message.meta?.webhookId === 'ci-1')
    assert.equal(received.length, 1)
    assert.equal(received[0].authorId, 'webhook')

    // 令牌不对：连房间存在与否都不多说。
    assert.equal((await service.webhookReceive(SAMPLE_ROOM_ID, `${token.slice(1)}a`, { text: 'x' })).reason, 'forbidden')
    // 轮换之后旧令牌立刻作废。
    const rotated = await call(service, SAMPLE_ROOM_ID, 'webhook', { action: 'rotate' })
    const next = tokenOf(rotated.body.path)
    assert.notEqual(next, token)
    assert.equal((await service.webhookReceive(SAMPLE_ROOM_ID, token, { text: 'x', id: 'ci-2' })).reason, 'forbidden')
    assert.equal((await service.webhookReceive(SAMPLE_ROOM_ID, next, { text: 'x', id: 'ci-3' })).ok, true)

    // 关掉之后整条路消失。
    const closed = await call(service, SAMPLE_ROOM_ID, 'webhook', { action: 'disable' })
    assert.equal(closed.body.path, null)
    assert.equal((await service.webhookReceive(SAMPLE_ROOM_ID, next, { text: 'x', id: 'ci-4' })).reason, 'not_found')
  } finally {
    store.db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
