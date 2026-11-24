// 受控浏览器的唯一名字与访问边界；服务端和界面只认这一份。
export const BROWSER_MCP_SERVER_NAME = 'chrome-devtools'

// MCP 的 allowedUrlPattern 与 blockedUrlPattern 互斥；这里只拦本机和本地文件，公网照常读。
// 模式遵循 URLPattern：主机必须是精确值或 `*`，部分 IPv4 通配（如 127.*）会被服务器拒绝，
// 所以这里按本机常见地址逐条写。局域网网段和 IPv6 字面量没有等价的合法模式，
// 不在这份清单里假装拦住；浏览器仍是独立、无输入、无脚本求值的临时 profile。
export const BROWSER_MCP_BLOCKED_PATTERNS = Object.freeze([
  'file://*',
  'http://localhost/*',
  'https://localhost/*',
  'http://localhost:*/*',
  'https://localhost:*/*',
  'http://127.0.0.1/*',
  'https://127.0.0.1/*',
  'http://127.0.0.1:*/*',
  'https://127.0.0.1:*/*',
  'http://0.0.0.0/*',
  'https://0.0.0.0/*',
  'http://0.0.0.0:*/*',
  'https://0.0.0.0:*/*',
  'http://*.local/*',
  'https://*.local/*',
  'http://*.internal/*',
  'https://*.internal/*',
])
