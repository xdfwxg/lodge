#!/usr/bin/env node
// 测试用 pi：说同一套 RPC 帧，用来确定性地验证驱动映射（不调模型）。

import { existsSync, linkSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

// 假 pi 也要能回答 `--help`：启动自检会先问它认不认扩展入口。
const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write('usage: pi [options]\n  -e, --extension <file>  load an extension\n  --mode <mode>  rpc|interactive\n')
  process.exit(0)
}

if (process.env.LODGE_FAKE_SKIP_EXTENSION !== '1' && typeof process.env.LODGE_EXTENSION_MARKER === 'string' && process.env.LODGE_EXTENSION_MARKER !== '') {
  try { writeFileSync(process.env.LODGE_EXTENSION_MARKER, 'ok') } catch {}
}
const write = frame => process.stdout.write(`${JSON.stringify(frame)}\n`)
const reply = text => {
  const usage = { input: 1, output: 1, cacheRead: 0 }
  // pi 会推 UI 状态；它不是提问，驱动不能因此收掉回合。
  write({ type: 'extension_ui_request', id: 'status', method: 'setStatus', status: 'working' })
  write({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } })
  write({ type: 'message_end', message: { role: 'assistant', usage } })
  write({ type: 'turn_end', message: { stopReason: 'stop' } })
  write({ type: 'agent_end' })
  write({ type: 'agent_settled', aborted: false })
}

// 直连探针：只有 EPERM 才算被边界拒绝，连接被拒/超时是探针问题。
const tcpProbe = (host, port) => new Promise(resolve => {
  const socket = net.connect({ host, port })
  let done = false
  const finish = value => {
    if (done) return
    done = true
    socket.destroy()
    resolve(value)
  }
  socket.once('connect', () => finish('connected'))
  socket.once('error', error => finish(error?.code === 'EPERM' ? 'denied:EPERM' : `failed:${error?.code ?? '?'}`))
  socket.setTimeout(3000, () => finish('failed:timeout'))
})

// 经代理的探针：直接说 HTTP，读状态行；403 才是代理拒绝，连不上是探测失败。
const proxyProbe = targetUrl => new Promise(resolve => {
  let proxy
  try {
    proxy = new URL(process.env.HTTP_PROXY ?? '')
  } catch {
    resolve('failed:no-proxy')
    return
  }
  const socket = net.connect({ host: proxy.hostname, port: Number(proxy.port) })
  let data = ''
  let done = false
  const finish = value => {
    if (done) return
    done = true
    socket.destroy()
    resolve(value)
  }
  socket.setTimeout(4000, () => finish('failed:timeout'))
  socket.once('connect', () => {
    const target = new URL(targetUrl)
    socket.write(`GET ${targetUrl} HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`)
  })
  socket.on('data', chunk => {
    data += chunk.toString()
  })
  socket.on('end', () => {
    const status = /^HTTP\/1\.[01] (\d{3})/.exec(data)?.[1]
    finish(status === '403' ? 'denied:403' : status ? `connected:${status}` : 'failed:empty')
  })
  socket.once('error', error => finish(error?.code === 'EPERM' ? 'denied:EPERM' : `failed:${error?.code ?? '?'}`))
})

const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    return
  }
  if (frame.type === 'prompt') {
    const text = String(frame.message ?? '')
    // 驱动会在前面加房间上下文；这一轮真正的内容在【这一轮】之后。
    const body = text.includes('【这一轮】') ? text.split('【这一轮】').pop().trim() : text
    if (body.includes('ECHO_ENV')) {
      // 设置有没有生效，只能看它到没到驱动跟前：把驱动交给 pi 的东西原样回显。
      reply(JSON.stringify({
        cwd: process.cwd(),
        granted: process.env.LODGE_GRANTED_TOOLS ?? null,
        denied: process.env.LODGE_DENIED_TOOLS ?? null,
        autoServers: process.env.LODGE_AUTO_SERVERS ?? null,
        approval: process.env.LODGE_APPROVAL ?? null,
        httpProxy: process.env.HTTP_PROXY ?? null,
      }))
      return
    }
    if (body.includes('多步')) {
      // 预算由基座执行：按消息里的次数发工具开始帧，超限的那一次必须停在半路。
      const count = Number(/多步[:：]\s*(\d+)/.exec(body)?.[1] ?? 1)
      for (let index = 0; index < count; index += 1) {
        write({ type: 'tool_execution_start', toolCallId: `call-${index}`, toolName: 'bash', args: { command: 'true' } })
        write({ type: 'tool_execution_end', toolCallId: `call-${index}`, toolName: 'bash', result: { content: [] }, isError: false })
      }
      reply('steps done')
      return
    }
    if (body.includes('活动')) {
      // 工具活动：开始与结束各一条，结束带回执（判定工具靠它取完整入参）。
      write({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'mcp__lodge_gate__submit_plan', args: { why: '契约' } })
      write({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'mcp__lodge_gate__submit_plan',
        result: { content: [{ type: 'text', text: 'ok' }], structuredContent: { ok: true, submissionId: 'sub-1' } },
        isError: false,
        durationMs: 12,
      })
      reply('activity done')
      return
    }
    if (body.includes('模型错误')) {
      // pi 把模型错误也按正常消息收尾；终态必须报失败，不能当成空回复完成。
      const message = { role: 'assistant', content: [], stopReason: 'error', errorMessage: '404: model not found' }
      write({ type: 'message_start', message })
      write({ type: 'message_end', message })
      write({ type: 'turn_end', message })
      write({ type: 'agent_end', messages: [message], isTerminal: true, willRetry: false })
      write({ type: 'agent_settled', aborted: false })
      return
    }
    if (body.includes('拒绝')) {
      write({ id: 'reject', type: 'response', command: 'prompt', success: false, error: 'compaction in progress' })
      process.exit(0)
    }
    if (body.includes('失败')) {
      process.stderr.write('fake pi: model request failed: connection reset\n')
      process.exit(1)
    }
    if (body.includes('重试一次')) {
      // 第一次一个字都不给就退出；重试之后正常回一句。
      const marker = join(tmpdir(), 'lodge-fake-pi-retry.marker')
      if (!existsSync(marker)) {
        writeFileSync(marker, '1')
        process.stderr.write('fake pi: connection reset\n')
        process.exit(1)
      }
      rmSync(marker, { force: true })
      reply('第二次成功')
      return
    }
    if (body.includes('权限')) {
      write({ type: 'extension_ui_request', id: 'ask-1', method: 'confirm', title: 'Allow bash?', message: 'git push origin main' })
      return
    }
    if (body.includes('慢')) return
    if (body.includes('流式中')) {
      write({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '正在做' } })
      return
    }
    if (body.includes('上下文')) {
      reply(`context:${text}`)
      return
    }
    if (body.includes('系统')) {
      const index = process.argv.indexOf('--append-system-prompt')
      reply(`system:${index >= 0 ? process.argv[index + 1] : ''}`)
      return
    }
    if (body.includes('出网')) {
      // 沙箱只放行代理；代理再按白名单拒绝未知主机。curl 认 HTTP(S)_PROXY。
      try {
        execFileSync('curl', ['-sS', '--max-time', '6', 'https://example.com'], { stdio: 'pipe' })
        reply('egress:ok')
      } catch (error) {
        const output = `${error?.stderr ?? ''}${error?.stdout ?? ''}`
        reply(`egress:denied${/denied by lodge-base egress|403/.test(output) ? '' : `:${error?.status ?? '?'}`}`)
      }
      return
    }
    if (body.includes('回环')) {
      // 平台控制面在回环上：直连和经代理都不该通。任何一条通了就是边界破了，必须给红灯。
      const port = /回环[:：]\s*(\d+)/.exec(body)?.[1]
      if (!port) {
        reply('loopback:missing-port')
        return
      }
      void (async () => {
        const direct = await tcpProbe('127.0.0.1', Number(port))
        const proxied = await proxyProbe(`http://127.0.0.1:${port}/api/health`)
        const leaked = direct === 'connected' || proxied.startsWith('connected')
        reply(leaked ? 'loopback:leaked' : `loopback:denied:${direct}/${proxied}`)
      })()
      return
    }
    if (body.includes('基准')) {
      // 沙箱基准探针：把每一条承诺跑成一次真实系统调用，结果回给验收套件比对。
      // 路径和端口走消息，不走环境变量——环境本身就是一道边界，探针不能靠它带私货。
      const payload = JSON.parse(/基准[:：]\s*(\{[\s\S]*\})/.exec(body)?.[1] ?? '{}')
      const home = payload.realHome ?? process.env.HOME ?? ''
      const work = process.cwd()
      const result = {}
      // 只有 EPERM/EACCES 才算“被边界拒绝”；文件不存在、端口不对是“探针坏了”，必须红。
      const denial = code => (code === 'EPERM' || code === 'EACCES' ? `denied:${code}` : `failed:${code ?? '?'}`)
      const read = (key, path) => {
        if (!path) {
          result[key] = 'missing-path'
          return
        }
        try {
          readFileSync(path)
          result[key] = 'allowed'
        } catch (error) {
          result[key] = denial(error?.code)
        }
      }
      const write = (key, path) => {
        try {
          writeFileSync(path, 'x')
          result[key] = 'ok'
        } catch (error) {
          result[key] = denial(error?.code)
        }
      }
      read('sshRead', `${home}/.ssh/id_ed25519`)
      read('awsRead', `${home}/.aws/credentials`)
      read('gnupgRead', `${home}/.gnupg/private-keys-v1.d/probe.key`)
      read('ghRead', `${home}/.config/gh/hosts.yml`)
      read('npmrcRead', `${home}/.npmrc`)
      read('netrcRead', `${home}/.netrc`)
      read('cargoRead', `${home}/.cargo/credentials.toml`)
      read('chromeRead', `${home}/Library/Application Support/Google/Chrome/Default/Cookies`)
      read('homeNoteRead', `${home}/notes.txt`)
      read('baseDbRead', payload.db)
      read('siblingRead', payload.sibling)
      read('otherRoomRead', payload.otherRoom)
      read('otherScratchRead', payload.otherScratch)
      write('workWrite', `${work}/lodge-bench-write`)
      write('homeWrite', `${home}/lodge-bench-write`)
      write('gitWrite', `${work}/.git/lodge-bench-write`)
      // 硬链接是绕过读拒绝的经典路子：把读不到的文件链进可写目录再读。写拒绝必须覆盖 link。
      try {
        linkSync(`${home}/.ssh/id_ed25519`, `${work}/lodge-bench-link`)
        result.hardlink = 'linked'
      } catch (error) {
        result.hardlink = denial(error?.code)
      }
      // 能力契约：边界之内，成员必须还能把活干成——跑 node、跑测试、看 git 状态。
      // git 提交是平台的事，成员写 .git 必须被拒；这条同时是 .git 只读的证据。
      const exec = (key, command, args) => {
        try {
          execFileSync(command, args, { cwd: work, stdio: 'pipe', timeout: 30_000 })
          result[key] = 'ok'
        } catch (error) {
          const text = `${error?.stderr ?? ''}${error?.stdout ?? ''}`
          if (/Operation not permitted|Permission denied/.test(text)) result[key] = 'denied:EPERM'
          else result[key] = `failed:${error?.status ?? error?.code ?? '?'}`
        }
      }
      exec('nodeRun', process.execPath, ['-e', "require('fs').writeFileSync('lodge-bench-out.json', 'ok')"])
      exec('npmTestOffline', 'npm', ['test', '--offline', '--no-audit', '--no-fund', '--loglevel=error'])
      exec('gitStatus', 'git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'status', '--porcelain'])
      try {
        execFileSync('git', ['-c', 'user.name=Probe', '-c', 'user.email=probe@local', 'add', '-A'], { cwd: work, stdio: 'pipe', timeout: 20_000 })
        execFileSync('git', ['-c', 'user.name=Probe', '-c', 'user.email=probe@local', 'commit', '-m', 'probe'], { cwd: work, stdio: 'pipe', timeout: 20_000 })
        result.gitCommit = 'committed'
      } catch (error) {
        const text = `${error?.stderr ?? ''}${error?.stdout ?? ''}`
        result.gitCommit = /Operation not permitted|Permission denied/.test(text)
          ? 'denied:EPERM'
          : `failed:${error?.status ?? error?.code ?? '?'}`
      }
      // 单文件上限：子进程写 9 MB，超过声明上限就停。
      const big = `${work}/lodge-bench-big`
      try {
        execFileSync('/bin/dd', ['if=/dev/zero', `of=${big}`, 'bs=1048576', 'count=9'], { stdio: 'ignore', timeout: 15_000 })
      } catch {}
      let bigSize = 0
      try {
        bigSize = statSync(big).size
      } catch {}
      result.fileCap = bigSize > 0 && bigSize <= 8 * 1024 * 1024 ? 'capped' : `uncapped:${bigSize}`
      // 环境：只带平台声明的那几样，别的（含凭据、平台变量）不该出现在孩子里。
      const env = (key, name) => {
        result[key] = process.env[name] ? 'present' : 'absent'
      }
      env('envPath', 'PATH')
      env('envPlatform', 'LODGE_BENCH_TOKEN')
      env('envProvider', 'ANTHROPIC_API_KEY')
      env('envGithub', 'GITHUB_TOKEN')
      // 信号：沙箱里的成员能管自己的孩子，不能碰沙箱外的平台进程。
      const signal = (key, pid) => {
        try {
          process.kill(pid, 0)
          result[key] = 'allowed'
        } catch (error) {
          result[key] = error?.code === 'EPERM' ? 'denied:EPERM' : `failed:${error?.code ?? '?'}`
        }
      }
      signal('signalOutside', Number(payload.basePid))
      const child = spawn('sleep', ['5'], { stdio: 'ignore' })
      signal('signalChild', child.pid)
      child.kill()
      void (async () => {
        // 本地监听：dev server / 测试服务器要 bind；默认边界不允许，这条探针把决定钉住。
        result.localBind = await new Promise(resolve => {
          const server = net.createServer()
          server.once('error', error => resolve(error?.code === 'EPERM' ? 'denied:EPERM' : `failed:${error?.code ?? '?'}`))
          server.listen(0, '127.0.0.1', () => {
            server.close()
            resolve('bound')
          })
        })
        result.directBase = await tcpProbe('127.0.0.1', Number(payload.port))
        result.directInternet = await tcpProbe('1.1.1.1', 80)
        result.proxyBase = await proxyProbe(`http://127.0.0.1:${payload.port}/api/health`)
        result.proxyInternet = await proxyProbe('http://example.com/')
        reply(`bench:${JSON.stringify(result)}`)
      })()
      return
    }
    if (body.includes('网络模式')) {
      reply(`proxy:${process.env.HTTP_PROXY ? 'proxy' : 'none'}`)
      return
    }
    if (body.includes('进程风暴')) {
      // 模拟停不下来的 fork：平台必须按进程组上限踩刹车，并写清原因。
      for (let index = 0; index < 10; index += 1) spawn('sleep', ['30'], { stdio: 'ignore' })
      return
    }
    if (body.includes('读兄弟')) {
      const path = /读兄弟[:：]\s*(\S+)/.exec(body)?.[1] ?? '/nonexistent'
      try {
        readFileSync(path)
        reply('sibling:read')
      } catch (error) {
        reply(`sibling:denied:${error?.code ?? 'unknown'}`)
      }
      return
    }
    if (body.includes('沙箱')) {
      // 沙箱里往 HOME 写应该被拒；没有沙箱时能写。
      try {
        writeFileSync(process.env.HOME + '/lodge-sandbox-probe', 'x')
        reply('sandbox:wrote')
      } catch (error) {
        reply(`sandbox:denied:${error?.code ?? 'unknown'}`)
      }
      return
    }
    if (body.includes('工作目录')) {
      reply(`cwd:${process.cwd()}`)
      return
    }
    if (body.includes('工具循环')) {
      // 模拟模型停不下来：连着调工具，看基座会不会在预算处踩刹车。
      for (let i = 0; i < 5; i += 1) {
        write({ type: 'tool_execution_start', toolCallId: `call-${i}`, toolName: 'grep', args: { pattern: 'x' } })
        write({ type: 'tool_execution_end', toolCallId: `call-${i}`, toolName: 'grep', result: { content: [] }, isError: false })
      }
      write({ type: 'agent_settled', aborted: false })
      return
    }
    if (body.includes('工具')) {
      const granted = process.env.LODGE_GRANTED_TOOLS ?? ''
      reply(`tools:${granted === '' ? 'none' : granted}`)
      return
    }
    if (body.includes('排除')) {
      const denied = process.env.LODGE_DENIED_TOOLS ?? ''
      reply(`exclude:${denied === '' ? 'none' : denied}`)
      return
    }
    if (body.includes('挂载')) {
      const path = process.env.LODGE_MCP_CONFIG
      if (!path) {
        reply('mcp:none')
        return
      }
      // 配置内容里只有服务器定义；这一回合的扩展路径也要真的存在。
      reply(`mcp:${readFileSync(path, 'utf8')}`)
      return
    }
    reply(`fake pi: ${body}`)
    return
  }
  if (frame.type === 'extension_ui_response') {
    reply('已收到回答')
  }
})
