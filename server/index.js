import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLodgeApp } from './app.js'

// 进程入口：组装在 app.js，这里只负责监听、信号和退出。
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

let app = null
try {
  app = await createLodgeApp({ root, onListenerLost: () => { void shutdown('listener-lost') } })
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
  console.error(`[lodge] 开始关闭：${cause}`)
  // 关闭慢不能变成“关了监听还占着端口”的僵尸：到点直接退。
  setTimeout(() => process.exit(cause === 'SIGINT' ? 130 : 1), 8_000).unref()
  try {
    // 关闭不能无限等：订阅或 SSE 卡住时，进程仍要退，不能留下一个关了监听、
    // 还占着端口的僵尸进程。
    await Promise.race([
      app.stop(),
      new Promise(resolve => setTimeout(resolve, 5000).unref()),
    ])
  } catch (error) {
    console.error(`[lodge] 关闭失败：${String(error?.message ?? error)}`)
  }
  process.exit(cause === 'SIGINT' ? 130 : cause === 'SIGTERM' ? 143 : 1)
}

process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })

// 监听被关掉时把调用栈留下来：出现过“进程还在、监听没了”的僵尸，没有栈就查不到是谁关的。
// 每次都记，不只第一次：现场里第二次关闭是静默的，正好把根因放跑了。
app.server.on('close', () => {
  console.error(`[lodge] 监听已关闭\n${new Error('server.close').stack ?? ''}`)
})

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
