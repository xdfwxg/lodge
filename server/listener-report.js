// 监听丢失的现场：出过「进程活着、内核不再接连接、JS 以为还在听」的故障，
// 每次只能看到结果。重建之前先把现场拍下来——Node 原生报告（libuv handles，含打开的
// TCP 句柄与 fd）+ lsof（这个进程实际持有的 socket）+ 服务对象自己的状态。
// 只写文件、只打一行摘要；写失败也不许挡住重建。
import { execFile } from 'node:child_process'
import { fstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as logger from './crew/log.js'

const lsofOf = pid => new Promise(resolve => {
  execFile('lsof', ['-nP', '-p', String(pid)], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
    // lsof 在进程没有匹配项时会返回非 0，但只要有输出就是我们要的现场。
    if (typeof stdout === 'string' && stdout.trim() !== '') resolve(stdout)
    else resolve(null)
  })
})

const socketSummary = text => {
  const lines = text.trim().split('\n').slice(1)
  const count = pattern => lines.filter(line => line.includes(pattern)).length
  return {
    fds: lines.length,
    sockets: count(' TCP '),
    established: count('(ESTABLISHED)'),
    closed: count('(CLOSED)'),
    listening: count('(LISTEN)'),
  }
}

export const captureListenerReport = async ({ dataDir, port, server = null, at = Date.now(), log = message => logger.warn(message) }) => {
  const dir = join(dataDir, 'logs')
  const base = join(dir, `listener-lost-${at}`)
  const written = []
  try {
    mkdirSync(dir, { recursive: true })
  } catch (error) {
    log(`[lodge] 监听丢失的现场没能落盘：${String(error?.message ?? error)}`)
    return null
  }

  const state = {
    at,
    port,
    pid: process.pid,
    // 这一层是故障的核心：内核说端口没了，JS 这边还可能说自己在听。
    listening: server?.listening ?? null,
    address: (() => {
      try { return server?.address?.() ?? null } catch { return null }
    })(),
    handleFd: server?._handle?.fd ?? null,
    // 关键证据：句柄记着的 fd，在内核里还是不是一个 socket。EBADF=被关了；不是 socket=号被复用了。
    fdState: (() => {
      const fd = server?._handle?.fd
      if (!Number.isInteger(fd) || fd < 0) return null
      try {
        const stats = fstatSync(fd)
        return { fd, isSocket: stats.isSocket(), isFile: stats.isFile(), isFIFO: stats.isFIFO(), mode: stats.mode }
      } catch (error) {
        return { fd, error: String(error?.code ?? error?.message ?? error) }
      }
    })(),
    activeResources: typeof process.getActiveResourcesInfo === 'function' ? process.getActiveResourcesInfo() : [],
  }

  try {
    process.report?.writeReport?.(`${base}.report.json`)
    written.push('report.json')
  } catch (error) {
    written.push(`report failed: ${String(error?.message ?? error)}`)
  }

  const lsof = await lsofOf(process.pid)
  if (lsof !== null) {
    try {
      writeFileSync(`${base}.lsof.txt`, lsof)
      state.sockets = socketSummary(lsof)
      written.push('lsof.txt')
    } catch (error) {
      written.push(`lsof write failed: ${String(error?.message ?? error)}`)
    }
  } else {
    written.push('lsof unavailable')
  }

  try {
    writeFileSync(`${base}.state.json`, `${JSON.stringify(state, null, 2)}\n`)
    written.push('state.json')
  } catch (error) {
    written.push(`state write failed: ${String(error?.message ?? error)}`)
  }

  const sockets = state.sockets
  log(`[lodge] 监听丢失的现场已写到 ${base}.{report.json,lsof.txt,state.json}（listening=${state.listening}，` +
    (sockets === undefined
      ? 'lsof 拿不到）'
      : `fd ${sockets.fds}，socket ${sockets.sockets}（ESTABLISHED ${sockets.established}、CLOSED ${sockets.closed}、LISTEN ${sockets.listening}））`))
  return { base, state, written }
}
