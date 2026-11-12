import { execFileSync } from 'node:child_process'

// 端口预检：有 lsof 时跳过已监听端口；没有 lsof 时退回原分配，不假装检测成功。
export const portIsFree = (port, { exec = execFileSync } = {}) => {
  try {
    const output = exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    })
    return String(output).trim() === ''
  } catch (error) {
    if (typeof error?.stdout === 'string' && error.stdout.trim() !== '') return false
    return true
  }
}

export const chooseFreePort = (start, { step = 10, attempts = 40, isFree = portIsFree } = {}) => {
  let port = start
  for (let index = 0; index < attempts; index += 1) {
    if (isFree(port)) return { port, next: port + step }
    port += step
  }
  return { port: start, next: start + step }
}
