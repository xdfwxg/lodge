import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLodgeApp } from './app.js'

// 进程入口：组装在 app.js，这里只负责监听、信号和退出。
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

let app = null
try {
  app = await createLodgeApp({ root })
} catch (error) {
  console.error(`[lodge] 启动失败：${String(error?.message ?? error)}`)
  process.exit(1)
}
// 桌面版主进程从这一行取一次性写操作令牌；这一行不进日志文件。
if (typeof app.actionToken === 'string' && app.actionToken !== '') {
  console.log(`LODGE_ACTION_TOKEN ${app.actionToken}`)
}

let closing = false
const shutdown = async cause => {
  if (closing) return
  closing = true
  try {
    await app.stop()
  } catch (error) {
    console.error(`[lodge] 关闭失败：${String(error?.message ?? error)}`)
  }
  process.exit(cause === 'SIGINT' ? 130 : cause === 'SIGTERM' ? 143 : 1)
}

process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })

app.server.once('error', error => {
  console.error(`[lodge] 服务监听失败：${String(error?.message ?? error)}`)
  void shutdown('ERROR')
})

app.server.listen(app.port, '127.0.0.1', () => {
  console.log(`Lodge server: http://127.0.0.1:${app.port}`)
  void app.start().catch(error => {
    console.error(`[lodge] 启动房间失败：${String(error?.message ?? error)}`)
  })
})
