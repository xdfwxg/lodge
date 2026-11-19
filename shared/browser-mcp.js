// 受控浏览器的唯一名字与访问边界；服务端和界面只认这一份。
export const BROWSER_MCP_SERVER_NAME = 'chrome-devtools'

// MCP 的 allowedUrlPattern 与 blockedUrlPattern 互斥；这里只拦本机和本地文件，公网照常读。
export const BROWSER_MCP_BLOCKED_PATTERNS = Object.freeze([
  'file://*',
  'http://localhost/*',
  'https://localhost/*',
  'http://127.0.0.1/*',
  'https://127.0.0.1/*',
  'http://0.0.0.0/*',
  'https://0.0.0.0/*',
])
