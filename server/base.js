const DEFAULT_BASE = 'http://127.0.0.1:8799'

export function createBaseClient({ baseUrl = process.env.CREW_BASE_URL ?? DEFAULT_BASE } = {}) {
  const json = async (path, { timeout = 5_000, ...init } = {}) => {
    const response = await fetch(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(timeout) })
    const body = await response.text()
    if (!response.ok) throw new Error(`base ${response.status} ${path}: ${body.slice(0, 200)}`)
    return body === '' ? null : JSON.parse(body)
  }

  return {
    baseUrl,
    bootstrap: () => json('/api/bots?messages=0'),

    instances: () => json('/api/instances'),

    threadMessages: (threadId, limit = 200) => json(`/api/threads/${threadId}/messages?limit=${limit}`),

    sendGroupMessage: (groupId, text) => json(`/api/groups/${groupId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      timeout: 15_000,
    }),

    respondToCard: (threadId, requestId, behavior) => json(`/api/threads/${threadId}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, behavior }),
      timeout: 10_000,
    }),

    createBot: payload => json('/api/bots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 20_000,
    }),

    deleteBot: botId => json(`/api/bots/${botId}`, { method: 'DELETE', timeout: 10_000 }),

    interruptBot: (botId, body = {}) => json(`/api/bots/${botId}/interrupt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeout: 10_000,
    }),

    createGroup: payload => json('/api/groups', {
      method: 'POST',
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

    async watchEvents({ onFrame, onState, signal }) {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      while (!signal?.aborted) {
        try {
          const response = await fetch(new URL('/api/events', baseUrl), {
            signal,
            headers: { accept: 'text/event-stream' },
          })
          if (!response.ok || response.body === null) throw new Error(`events ${response.status}`)
          onState?.({ connected: true, error: null })
          const reader = response.body.getReader()
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
              const data = block.split('\n')
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trimStart())
                .join('\n')
              if (data === '') continue
              let frame
              try {
                frame = JSON.parse(data)
              } catch {
                continue
              }
              onFrame?.(frame)
            }
          }
        } catch (error) {
          if (signal?.aborted) return
          onState?.({ connected: false, error: String(error?.message ?? error) })
        }
        if (signal?.aborted) return
        await wait(2_000)
      }
    },
  }
}
