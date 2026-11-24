// 基座的线上契约：路径、方法、请求体和错误格式都在这里钉住。
// 基座冻结在 8799，Lodge 只通过 server/base.js 这一个 HTTP 边界说话；
// 这条测试跑的是真 fetch + 真 HTTP，不是手写 client。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createBaseClient } from './base.js'

const withServer = async (handler, run) => {
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const entry = {
      method: request.method,
      path: request.url,
      headers: request.headers,
      body,
      text: body.toString('utf8'),
    }
    requests.push(entry)
    await handler(entry, response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  try {
    return await run({ client: createBaseClient({ baseUrl }), requests })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

const json = (response, payload) => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

test('every JSON route matches the frozen base contract', async () => {
  await withServer((entry, response) => {
    json(response, { ok: true, echo: entry.path })
  }, async ({ client, requests }) => {
    await client.bootstrap()
    await client.config()
    await client.patchConfig({ x: 1 })
    await client.skillsLibrary()
    await client.readLibrarySkill('a b')
    await client.importLibrarySkill('text')
    await client.approveLibrarySkill('a b')
    await client.instances()
    await client.threadMessages('thread-1', 25)
    await client.sendGroupMessage('group-1', 'hello', { sendId: 's-1', mentions: ['bot-1'] })
    await client.sendGroupMessage('group-1', 'plain')
    await client.setGroupHold('group-1', 'bot-1', true)
    await client.steerGroupQueue('group-1', 'q-1')
    await client.cancelGroupQueue('group-1', 'q-1')
    await client.respondToCard('thread-1', 'req-1', 'deny')
    await client.respondToCard('thread-1', 'req-1', 'answer', 'yes')
    await client.createBot({ name: '甲' })
    await client.patchBot('bot-1', { name: '乙' })
    await client.deleteBot('bot-1')
    await client.setBotSkills('bot-1', ['a'])
    await client.interruptBot('bot-1', { threadId: 't' })
    await client.createGroup({ name: 'g' })
    await client.patchGroup('group-1', { unread: false })
    await client.setupGroup('group-1', { cwd: '/tmp' })
    await client.patchGroupTask('group-1', 'thread-1', { title: 't' })
    await client.deleteGroup('group-1')
    await client.mcpServers()
    await client.createMcpServer({ name: 'm' })
    await client.updateMcpServer('a b', { name: 'm' })
    await client.patchMcpServer('a b', { name: 'm2' })
    await client.deleteMcpServer('a b')

    assert.deepEqual(requests.map(item => [item.method, item.path]), [
      ['GET', '/api/bots?messages=0'],
      ['GET', '/api/config'],
      ['PATCH', '/api/config'],
      ['GET', '/api/skills-library'],
      ['GET', '/api/skills-library/a%20b'],
      ['POST', '/api/skills-library'],
      ['PATCH', '/api/skills-library/a%20b'],
      ['GET', '/api/instances'],
      ['GET', '/api/threads/thread-1/messages?limit=25'],
      ['POST', '/api/groups/group-1/messages'],
      ['POST', '/api/groups/group-1/messages'],
      ['POST', '/api/groups/group-1/holds'],
      ['POST', '/api/groups/group-1/queue/q-1/steer'],
      ['DELETE', '/api/groups/group-1/queue/q-1'],
      ['POST', '/api/threads/thread-1/respond'],
      ['POST', '/api/threads/thread-1/respond'],
      ['POST', '/api/bots'],
      ['PATCH', '/api/bots/bot-1'],
      ['DELETE', '/api/bots/bot-1'],
      ['PUT', '/api/bots/bot-1/skills-library'],
      ['POST', '/api/bots/bot-1/interrupt'],
      ['POST', '/api/groups'],
      ['PATCH', '/api/groups/group-1'],
      ['PATCH', '/api/groups/group-1/setup'],
      ['PATCH', '/api/groups/group-1/tasks/thread-1'],
      ['DELETE', '/api/groups/group-1'],
      ['GET', '/api/mcp/servers'],
      ['POST', '/api/mcp/servers'],
      ['PUT', '/api/mcp/servers/a%20b'],
      ['PATCH', '/api/mcp/servers/a%20b'],
      ['DELETE', '/api/mcp/servers/a%20b'],
    ])

    assert.equal(requests[2].text, '{"x":1}')
    assert.equal(requests[5].text, '{"text":"text"}')
    assert.equal(requests[9].text, JSON.stringify({
      text: 'hello',
      sendId: 's-1',
      mentions: ['bot-1'],
    }))
    assert.equal(requests[10].text, JSON.stringify({ text: 'plain' }))
    assert.equal(requests[11].text, JSON.stringify({ botId: 'bot-1', held: true }))
    assert.equal(requests[12].text, '{}')
    assert.equal(requests[14].text, JSON.stringify({ requestId: 'req-1', behavior: 'deny' }))
    assert.equal(requests[15].text, JSON.stringify({ requestId: 'req-1', behavior: 'answer', message: 'yes' }))
    assert.equal(requests[16].text, JSON.stringify({ name: '甲' }))
    assert.equal(requests[19].text, JSON.stringify({ skills: ['a'] }))
    assert.equal(requests[20].text, JSON.stringify({ threadId: 't' }))
  })
})

test('a base error keeps the status, path and a short body', async () => {
  await withServer((entry, response) => {
    response.writeHead(409, { 'content-type': 'text/plain' })
    response.end('already running '.repeat(50))
  }, async ({ client }) => {
    await assert.rejects(
      () => client.sendGroupMessage('g', 'x'),
      /^Error: base 409 \/api\/groups\/g\/messages: already running/,
    )
  })
})

test('uploads and attachment reads keep bytes and mime', async () => {
  await withServer(async (entry, response) => {
    if (entry.path.startsWith('/api/attachments/')) {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(Buffer.from([1, 2, 3]))
      return
    }
    json(response, { path: entry.path })
  }, async ({ client, requests }) => {
    const uploaded = await client.uploadImage(Buffer.from('png'), 'image/png')
    assert.deepEqual(uploaded, { path: '/api/attachments' })
    assert.equal(requests[0].method, 'POST')
    assert.equal(requests[0].headers['content-type'], 'image/png')
    assert.equal(requests[0].text, 'png')

    await client.uploadFile(Buffer.from('doc'), 'a b.txt', 'text/plain')
    assert.equal(requests[1].path, '/api/files?name=a%20b.txt')
    assert.equal(requests[1].headers['content-type'], 'text/plain')

    const attachment = await client.attachment('a b.png')
    assert.equal(requests[2].path, '/api/attachments/a%20b.png')
    assert.equal(attachment.mime, 'image/png')
    assert.deepEqual([...attachment.bytes], [1, 2, 3])
  })
})

test('the event stream parses frames and reconnects with the last id', async () => {
  let connections = 0
  const headers = []
  const server = createServer((request, response) => {
    connections += 1
    headers.push(request.headers)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (connections === 1) {
      response.write('id: 7\n')
      response.write(`data: ${JSON.stringify({ kind: 'ready', n: 1 })}\n\n`)
      response.write('data: not-json\n\n')
      response.end()
      return
    }
    response.write(`data: ${JSON.stringify({ kind: 'ready', n: 2 })}\n\n`)
    // 保持连接，让客户端停在流上，测试结束后 abort。
    setTimeout(() => response.end(), 100)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const client = createBaseClient({ baseUrl: `http://127.0.0.1:${server.address().port}` })
  const frames = []
  const states = []
  const controller = new AbortController()
  const seen = new Promise(resolve => {
    void client.watchEvents({
      signal: controller.signal,
      onState: state => states.push(state),
      onFrame: frame => {
        frames.push(frame)
        if (frame.n === 2) resolve()
      },
    })
  })
  try {
    await seen
    assert.deepEqual(frames, [{ kind: 'ready', n: 1 }, { kind: 'ready', n: 2 }])
    assert.equal(states[0].connected, true)
    assert.equal(connections, 2)
    assert.equal(headers[1]['last-event-id'], '7')
  } finally {
    controller.abort()
    await new Promise(resolve => server.close(resolve))
  }
})
