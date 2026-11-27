// 这间 Lodge 对客户端说的话只有这一份清单：方法、路径、回应形状。
// 抄 Codex App Server 的规矩——协议是一份显式的契约，路由表就是它本身：
// `http.js` 只提供每个接口的处理函数，按这张表分派；少一个处理函数启动就崩。
//
// kind：json=一份 JSON；events=SSE 长连接；bytes=二进制；static=界面文件。
// auth：none=谁都能问（探活）；token=桌面动作令牌；room=房间自己的动作（由房间判定）。
//
// 表里的顺序就是匹配顺序：具体路由在前，`/api/rooms/:roomId/:action` 这种通用路由在后。
import { roomActionPattern } from './route-table.js'

export const API_ROUTES = Object.freeze([
  // 外部事件按房间令牌投进来；令牌就是鉴权，不走桌面动作令牌。
  { method: 'POST', path: '/api/webhooks/:roomId/:token', kind: 'json', auth: 'room', pattern: /^\/api\/webhooks\/([\w-]+)\/([a-f0-9]{8,128})$/i },

  { method: 'GET', path: '/api/state', kind: 'json', auth: 'none' },
  { method: 'GET', path: '/api/health', kind: 'json', auth: 'none' },
  // 监听自检只问“这个端口后面是不是 Lodge 自己”，不碰基座。
  { method: 'GET', path: '/api/ping', kind: 'json', auth: 'none' },
  { method: 'POST', path: '/api/system/choose-directory', kind: 'json', auth: 'token' },
  { method: 'POST', path: '/api/system/open-path', kind: 'json', auth: 'token' },
  { method: 'GET', path: '/api/events', kind: 'events', auth: 'none' },
  { method: 'POST', path: '/api/profile', kind: 'json', auth: 'token' },
  { method: 'GET', path: '/api/settings/email', kind: 'json', auth: 'none' },
  { method: 'POST', path: '/api/settings/email', kind: 'json', auth: 'token' },
  { method: 'POST', path: '/api/rooms', kind: 'json', auth: 'none' },
  { method: 'POST', path: '/api/rooms/sample', kind: 'json', auth: 'none' },

  { method: 'GET', path: '/api/rooms/:roomId/assignments', kind: 'json', auth: 'none', pattern: /^\/api\/rooms\/([\w-]+)\/assignments$/ },
  { method: 'GET', path: '/api/workspace/memory', kind: 'json', auth: 'none' },
  { method: 'POST', path: '/api/workspace/memory/review', kind: 'json', auth: 'token' },
  { method: 'POST', path: '/api/attachments', kind: 'json', auth: 'none' },
  { method: 'GET', path: '/api/attachments/:name', kind: 'bytes', auth: 'none', pattern: /^\/api\/attachments\/([A-Za-z0-9._-]+)$/ },
  { method: 'GET', path: '/api/rooms/:roomId/artifact', kind: 'json', auth: 'none', pattern: /^\/api\/rooms\/([\w-]+)\/artifact$/ },
  { method: 'GET', path: '/api/rooms/:roomId/memory', kind: 'json', auth: 'none', pattern: /^\/api\/rooms\/([\w-]+)\/memory$/ },
  { method: 'POST', path: '/api/rooms/:roomId/memory/opt-out', kind: 'json', auth: 'room', pattern: /^\/api\/rooms\/([\w-]+)\/memory\/opt-out$/ },
  { method: 'POST', path: '/api/rooms/:roomId/memory/:memoryId/review', kind: 'json', auth: 'room', pattern: /^\/api\/rooms\/([\w-]+)\/memory\/([\w-]+)\/review$/ },
  { method: 'GET', path: '/api/rooms/:roomId/evidence/:messageId', kind: 'json', auth: 'none', pattern: /^\/api\/rooms\/([\w-]+)\/evidence\/([\w-]+)$/ },
  { method: 'GET', path: '/api/rooms/:roomId/rounds/:roundId', kind: 'json', auth: 'none', pattern: /^\/api\/rooms\/([\w-]+)\/rounds\/([\w-]+)$/ },

  // 房间动作：动作名就是 route-table.js 里那一份 ROOM_ACTIONS；不认识的动作仍然 404。
  { method: 'POST', path: '/api/rooms/:roomId/:action', kind: 'json', auth: 'room', pattern: roomActionPattern },
])

export const routeKey = route => `${route.method} ${route.path}`

const namesOf = path => [...path.matchAll(/:([A-Za-z]+)/g)].map(match => match[1])

// 把一条请求按表匹配成参数；字面量直接比，动态用 pattern 抓。
export const matchRoute = (route, path) => {
  if (route.pattern !== undefined) {
    const match = route.pattern.exec(path)
    if (match === null) return null
    const names = namesOf(route.path)
    const params = {}
    for (const [index, name] of names.entries()) params[name] = match[index + 1]
    return params
  }
  if (route.path === path) return {}
  return null
}
