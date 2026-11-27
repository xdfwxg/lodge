import net from 'node:net'
import * as logger from './crew/log.js'

// 连一次端口，分清“没人接”和“循环忙”：拒连说明端口后面真的没了；
// 超时说明连接堆在队列里没人处理，那是负载，不是监听丢了。
const tcpProbe = (host, port, timeoutMs) => new Promise(resolve => {
  const socket = net.connect({ host, port })
  let settled = false
  const done = value => {
    if (settled) return
    settled = true
    socket.destroy()
    resolve(value)
  }
  socket.setTimeout(timeoutMs)
  socket.once('connect', () => done('open'))
  socket.once('timeout', () => done('busy'))
  socket.once('error', error => done(error?.code === 'ECONNREFUSED' ? 'refused' : 'busy'))
})

// 监听消失的自检：出现过多次「进程还在、端口已经不接连接」——界面全白，房间照跑。
// 判据只看“连上去还是被拒”：被拒才是端口没了；连上了但没回答，是循环忙，不判死。
// 关掉旧监听再在原端口重开一次，**重开之后必须自连一次确认**——listen 回调只说明绑上了，
// 不说明这个端口真的能接连接（现场见过回调成功、socket 却是 CLOSED 的僵尸）。
// 起不来或自证失败就如实返回 false，让外面决定退出。
// 端口被占用时 listen 不抛错，而是异步发 'error'：不接住它既等不到超时，
// 又会把错误交给入口的 handler 走成整进程退出，所以这里自己接一次。
export const rebindOnce = (server, {
  host = '127.0.0.1',
  port,
  timeoutMs = 5_000,
  verify = () => tcpProbe(host, port, 1_500).then(state => state === 'open'),
} = {}) => new Promise(resolve => {
  let settled = false
  let timer = null
  const finish = value => {
    if (settled) return
    settled = true
    if (timer !== null) clearTimeout(timer)
    server.off('error', onError)
    resolve(value)
  }
  const onError = () => finish(false)
  timer = setTimeout(() => finish(false), timeoutMs)
  timer.unref?.()
  server.on('error', onError)
  try {
    server.close(() => {
      if (settled) return
      try {
        server.listen(port, host, () => {
          // 回调只说明绑上了：再自己连一次。现场见过回调成功、socket 却是 CLOSED 的僵尸。
          void verify().then(ok => finish(ok === true)).catch(() => finish(false))
        })
      } catch {
        finish(false)
      }
    })
    // 事件流是长连接，close() 会一直等它们自己结束——真出故障时它们永远不结束，
    // 回调不来，端口就停在“关了还没开”的半死状态。重建必须主动断掉旧连接。
    server.closeAllConnections?.()
  } catch {
    finish(false)
  }
})

export const createListenerWatch = ({
  port,
  host = '127.0.0.1',
  intervalMs = 30_000,
  failures = 2,
  probe = null,
  onLost = null,
  log = message => logger.warn(message),
}) => {
  // 探活分两步，先问“端口还接不接连接”，再问“后面是不是 Lodge 自己”：
  // 被拒 = 监听没了；连上了却没回答 = 循环忙，不判死；别人占住端口 = 也算没了。
  const attempt = probe ?? (async () => {
    const state = await tcpProbe(host, port, 2_000)
    if (state === 'refused') return false
    if (state !== 'open') return true
    try {
      const response = await fetch(`http://${host}:${port}/api/ping`, { signal: AbortSignal.timeout(2_000) })
      if (!response.ok) return false
      // 答上来了但不是 Lodge：端口被别的服务占了，也算监听没了。
      const body = await response.json().catch(() => null)
      return body?.server === 'lodge'
    } catch {
      // 连得上、只是没来得及回答：先当作还活着，别把忙碌当成端口没了。
      return true
    }
  })
  let misses = 0
  let timer = null
  let stopped = false
  let reported = false

  const tick = async () => {
    if (stopped) return
    const ok = await attempt().catch(() => false)
    if (stopped) return
    if (ok) {
      misses = 0
      return
    }
    misses += 1
    if (misses < failures || reported) return
    reported = true
    log(`[lodge] 监听没了：${host}:${port} 连不上（连续 ${misses} 次）；进程还在，但已经不能服务。`)
    if (typeof onLost === 'function') onLost()
  }

  return {
    start() {
      if (timer !== null || stopped) return
      // 启动后先等一个间隔：listen 回调之后立刻连自己有时会抢在就绪前。
      timer = setInterval(() => { void tick() }, intervalMs)
      timer.unref?.()
    },
    stop() {
      stopped = true
      if (timer !== null) clearInterval(timer)
      timer = null
    },
    // 重建成功之后从头算：不清掉标记的话，下一次抖动再也不会叫人了。
    reset() {
      misses = 0
      reported = false
    },
    // 测试和排查用：手动跑一次。
    tick,
    get misses() { return misses },
  }
}
