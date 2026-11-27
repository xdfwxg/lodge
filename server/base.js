const DEFAULT_BASE = 'http://127.0.0.1:8799'

export function createBaseClient({ baseUrl = process.env.CREW_BASE_URL ?? DEFAULT_BASE } = {}) {
  const json = async (path, { timeout = 5_000, ...init } = {}) => {
    const response = await fetch(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(timeout) })
    const body = await response.text()
    if (!response.ok) throw new Error(`base ${response.status} ${path}: ${body.slice(0, 200)}`)
    return body === '' ? null : JSON.parse(body)
  }

  const raw = async (path, { timeout = 30_000, ...init } = {}) => {
    const response = await fetch(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(timeout) })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`base ${response.status} ${path}: ${body.slice(0, 200)}`)
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mime: response.headers.get('content-type') ?? 'application/octet-stream',
    }
  }

  return {
    baseUrl,
    bootstrap: () => json('/api/bots?messages=0'),
    health: () => json('/api/health'),

    // 基座自己的附件库：图片走原生视觉输入，文件按路径交给能读文件的人。
    uploadImage: (bytes, mime) => json('/api/attachments', {
      method: 'POST',
      headers: { 'content-type': mime },
      body: bytes,
      timeout: 30_000,
    }),

    uploadFile: (bytes, name, mime) => json(`/api/files?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': mime || 'application/octet-stream' },
      body: bytes,
      timeout: 60_000,
    }),

    attachment: name => raw(`/api/attachments/${encodeURIComponent(name)}`, { timeout: 15_000 }),

    config: () => json('/api/config'),

    patchConfig: payload => json('/api/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 10_000,
    }),

    skillsLibrary: () => json('/api/skills-library'),

    readLibrarySkill: name => json(`/api/skills-library/${encodeURIComponent(name)}`),

    importLibrarySkill: text => json('/api/skills-library', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      timeout: 15_000,
    }),

    deleteLibrarySkill: name => json(`/api/skills-library/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
    approveLibrarySkill: name => json(`/api/skills-library/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
      timeout: 10_000,
    }),

    instances: () => json('/api/instances'),

    threadMessages: (threadId, limit = 1000) => json(`/api/threads/${threadId}/messages?limit=${limit}`),

    sendGroupMessage: (groupId, text, { sendId, mentions = [] } = {}) => json(`/api/groups/${groupId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        ...(sendId === undefined ? {} : { sendId }),
        ...(mentions.length === 0 ? {} : { mentions }),
      }),
      timeout: 15_000,
    }),

    setGroupHold: (groupId, botId, held) => json(`/api/groups/${groupId}/holds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botId, held }),
      timeout: 10_000,
    }),

    steerGroupQueue: (groupId, queueId) => json(`/api/groups/${groupId}/queue/${queueId}/steer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      timeout: 10_000,
    }),

    cancelGroupQueue: (groupId, queueId) => json(`/api/groups/${groupId}/queue/${queueId}`, {
      method: 'DELETE',
      timeout: 10_000,
    }),

    respondToCard: (threadId, requestId, behavior, message) => json(`/api/threads/${threadId}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId,
        behavior,
        ...(typeof message === 'string' && message !== '' ? { message } : {}),
      }),
      timeout: 10_000,
    }),

    createBot: payload => json('/api/bots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 20_000,
    }),

    patchBot: (botId, payload) => json(`/api/bots/${botId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 20_000,
    }),

    mcpServers: () => json('/api/mcp/servers'),

    createMcpServer: payload => json('/api/mcp/servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 10_000,
    }),

    updateMcpServer: (name, payload) => json(`/api/mcp/servers/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 10_000,
    }),

    patchMcpServer: (name, payload) => json(`/api/mcp/servers/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 10_000,
    }),

    deleteMcpServer: name => json(`/api/mcp/servers/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      timeout: 10_000,
    }),

    deleteBot: botId => json(`/api/bots/${botId}`, { method: 'DELETE', timeout: 10_000 }),

    setBotSkills: (botId, skills) => json(`/api/bots/${botId}/skills-library`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skills }),
      timeout: 10_000,
    }),

    interruptBot: (botId, body = {}) => json(`/api/bots/${botId}/interrupt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeout: 10_000,
    }),

    // 受限执行：证明/反例由基座在边界里跑。work 必须在基座声明的工作根下，整轮不出网。
    runSandboxed: ({ work, command, timeoutMs = 120_000 } = {}) => json('/api/sandbox/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ work, command, timeoutMs }),
      timeout: timeoutMs + 5_000,
    }),

    createGroup: payload => json('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 15_000,
    }),

    patchGroup: (groupId, payload) => json(`/api/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 15_000,
    }),

    setupGroup: (groupId, payload) => json(`/api/groups/${groupId}/setup`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 15_000,
    }),

    patchGroupTask: (groupId, threadId, payload) => json(`/api/groups/${groupId}/tasks/${threadId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 15_000,
    }),

    deleteGroup: groupId => json(`/api/groups/${groupId}`, { method: 'DELETE', timeout: 10_000 }),

    async watchEvents({ onFrame, onState, signal, retryMs = 2_000 }) {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      let lastEventId = null
      // 重连退避：连接断了先等 2 秒，连着断就翻倍，封顶 30 秒，连上之后恢复。
      // 每 2 秒一条新连接会在基座忙碌时堆成连接风暴（真实现场：30 分钟 800 多个 socket）。
      let failures = 0
      while (!signal?.aborted) {
        // 每条连接自己的 AbortController：断开、出错、重连之前都要把它读的一端关掉。
        // 只靠外面那一个 signal，重连时旧连接的 body 没人取消，socket 会一直挂在进程里
        // （真实现场：一次半小时的会话攒了 800 多个 CLOSED socket，最后把监听挤死）。
        const connection = new AbortController()
        const stop = () => connection.abort()
        signal?.addEventListener?.('abort', stop, { once: true })
        let reader = null
        try {
          const response = await fetch(new URL('/api/events', baseUrl), {
            signal: connection.signal,
            headers: {
              accept: 'text/event-stream',
              ...(lastEventId === null ? {} : { 'last-event-id': lastEventId }),
            },
          })
          if (!response.ok || response.body === null) throw new Error(`events ${response.status}`)
          failures = 0
          onState?.({ connected: true, error: null })
          reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let cut
            while ((cut = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, cut)
              buffer = buffer.slice(cut + 2)
              const lines = block.split('\n')
              const eventId = lines.find(line => line.startsWith('id:'))?.slice(3).trim() ?? null
              const data = lines
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trimStart())
                .join('\n')
              if (data === '') {
                if (eventId !== null && eventId !== '') lastEventId = eventId
                continue
              }
              let frame
              try {
                frame = JSON.parse(data)
              } catch {
                continue
              }
              if (eventId !== null && eventId !== '') lastEventId = eventId
              onFrame?.(frame)
            }
          }
        } catch (error) {
          if (signal?.aborted) return
          failures += 1
          onState?.({ connected: false, error: String(error?.message ?? error) })
        } finally {
          signal?.removeEventListener?.('abort', stop)
          try {
            await reader?.cancel()
          } catch {}
          connection.abort()
          reader = null
        }
        if (signal?.aborted) return
        await wait(Math.min(30_000, retryMs * 2 ** Math.min(failures, 4)))
      }
    },
  }
}
