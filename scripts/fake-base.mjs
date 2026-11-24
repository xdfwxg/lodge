// 桌面壳冒烟用的假基座：只回答启动需要的最小接口，不碰真实 bot 或群。
import { createServer } from 'node:http'

const instances = {
  instances: [
    {
      instanceId: 'claude',
      driverKind: 'claudeAgent',
      displayName: 'Claude',
      snapshot: { state: 'available', authenticated: true },
      models: { default: 'claude-sonnet-5', options: [] },
      login: { args: ['login'], command: 'claude' },
      capabilities: {},
    },
  ],
}

export const startFakeBase = () => new Promise(resolveBase => {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname
    if (path === '/api/instances') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(instances))
      return
    }
    if (path === '/api/bots') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ bots: [], groups: [] }))
      return
    }
    if (path === '/api/config') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ features: {} }))
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end('{}')
  })
  server.listen(0, '127.0.0.1', () => resolveBase({
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolveClose => server.close(resolveClose)),
  }))
})
