import { useSyncExternalStore } from 'react'

const EMPTY = {
  phase: 'loading',
  rooms: [],
  dispatch: null,
  seats: [],
  templates: [],
  engines: [],
  runtime: null,
  budget: null,
  resources: null,
  usage: null,
  review: null,
  reviewFor: null,
  activeId: 'dispatch',
  error: null,
}

export function createStore() {
  let state = EMPTY
  let source = null
  let stopped = false
  const seen = new Set()
  const listeners = new Set()

  const emit = next => {
    state = next
    for (const listener of listeners) listener()
  }
  const patch = next => emit({ ...state, ...next })
  const lastSeq = () => Math.max(0, ...state.rooms.map(room => room.messages.at(-1)?.seq ?? 0))

  const acceptMessage = message => {
    if (seen.has(message.id)) return
    seen.add(message.id)
    const rooms = state.rooms.map(room => (
      room.id === message.roomId
        ? { ...room, messages: [...room.messages, message].sort((a, b) => a.seq - b.seq) }
        : room
    ))
    patch({ rooms })
  }

  const acceptPatch = message => {
    if (!seen.has(message.id)) {
      acceptMessage(message)
      return
    }
    const rooms = state.rooms.map(room => (
      room.id === message.roomId
        ? { ...room, messages: room.messages.map(item => (item.id === message.id ? { ...item, ...message } : item)) }
        : room
    ))
    patch({ rooms })
  }

  const acceptRoom = room => {
    const known = state.rooms.some(item => item.id === room.id)
    const rooms = known
      ? state.rooms.map(item => (item.id === room.id ? { ...room, brief: room.brief ?? item.brief, messages: item.messages } : item))
      : [...state.rooms, { ...room, messages: [] }]
    const order = new Map(state.rooms.map((item, index) => [item.id, index]))
    rooms.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
    const globalSpentMicroUsd = rooms.reduce((sum, item) => sum + (item.usage?.costMicroUsd ?? 0), 0)
    patch({
      rooms,
      ...(state.budget === null ? {} : { budget: { ...state.budget, globalSpentMicroUsd } }),
    })
  }

  const connect = () => {
    source?.close()
    const events = new EventSource(`/api/events?since=${lastSeq()}`)
    source = events
    events.addEventListener('open', () => {
      if (!stopped) patch({ phase: 'live', error: null })
    })
    events.addEventListener('msg', event => {
      if (!stopped) acceptMessage(JSON.parse(event.data))
    })
    events.addEventListener('msg.patch', event => {
      if (!stopped) acceptPatch(JSON.parse(event.data))
    })
    events.addEventListener('room', event => {
      if (!stopped) acceptRoom(JSON.parse(event.data))
    })
    events.addEventListener('dispatch', event => {
      if (!stopped) patch({ dispatch: JSON.parse(event.data) })
    })
    events.addEventListener('error', () => {
      if (!stopped) patch({ phase: state.phase === 'loading' ? 'loading' : 'reconnecting' })
    })
  }

  const load = async () => {
    try {
      const response = await fetch('/api/state')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      let runtime = null
      try {
        const health = await fetch('/api/health')
        if (health.ok) runtime = (await health.json()).runtime ?? null
      } catch {
        runtime = { ok: false, error: '健康检查失败' }
      }
      for (const room of data.rooms) for (const message of room.messages) seen.add(message.id)
      if (stopped) return
      const known = state.activeId === 'dispatch' || data.rooms.some(room => room.id === state.activeId)
      emit({
        ...state,
        phase: 'ready',
        rooms: data.rooms,
        dispatch: data.dispatch,
        seats: data.seats,
        templates: data.templates ?? [],
        engines: data.engines ?? [],
        runtime,
        budget: data.budget ?? null,
        activeId: known ? state.activeId : (data.rooms[0]?.id ?? 'dispatch'),
        error: null,
      })
      connect()
    } catch (error) {
      if (!stopped) patch({ phase: 'error', error: String(error?.message ?? error) })
    }
  }

  const download = (name, text) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const post = async (path, body) => {
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.error ?? `HTTP ${response.status}`)
      }
      patch({ error: null })
      return await response.json()
    } catch (error) {
      patch({ error: String(error?.message ?? error) })
      return null
    }
  }

  const loadResources = async () => {
    try {
      const response = await fetch('/api/resources')
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.resources === undefined) throw new Error(data.error ?? `HTTP ${response.status}`)
      patch({ resources: data.resources })
    } catch (error) {
      patch({ error: `资源面板加载失败：${String(error?.message ?? error)}` })
    }
  }

  const loadUsage = async (range = '7d') => {
    try {
      const response = await fetch(`/api/usage?range=${encodeURIComponent(range)}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.usage === undefined) throw new Error(data.error ?? `HTTP ${response.status}`)
      patch({ usage: data.usage })
    } catch (error) {
      patch({ error: `用量账本加载失败：${String(error?.message ?? error)}` })
    }
  }

  const openReview = async roomId => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/review`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.review === undefined) throw new Error(data.error ?? `HTTP ${response.status}`)
      patch({ review: data.review, reviewFor: roomId, error: null })
    } catch (error) {
      patch({ error: `复盘加载失败：${String(error?.message ?? error)}` })
    }
  }

  const importHandoff = async bundle => {
    const data = await post('/api/rooms/import', bundle)
    if (data?.room === undefined) return { ok: false, error: state.error ?? '导入交接包失败' }
    await load()
    patch({ activeId: data.room.id })
    return { ok: true, room: data.room }
  }

  const activeRoom = () => state.rooms.find(room => room.id === state.activeId)

  return {
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => state,
    start: () => {
      stopped = false
      void load()
    },
    disconnect: () => {
      stopped = true
      source?.close()
      source = null
      seen.clear()
    },
    select: activeId => patch({ activeId, review: null, reviewFor: null }),
    loadResources,
    loadUsage,
    resetMcp: server => post(`/api/rooms/${state.activeId}/mcp/reset`, { server }),
    openReview,
    closeReview: () => patch({ review: null, reviewFor: null }),
    send: text => post(`/api/rooms/${state.activeId}/messages`, { text }),
    accept: stage => post(`/api/rooms/${state.activeId}/accept`, { stage }),
    answer: async (stage, text) => {
      if (text !== '') {
        const sent = await post(`/api/rooms/${state.activeId}/messages`, { text })
        if (sent === null) return null
      }
      return post(`/api/rooms/${state.activeId}/accept`, { stage })
    },
    simulate: () => post(`/api/rooms/${state.activeId}/simulate`, {}),
    setAcceptance: (stage, command) => post(`/api/rooms/${state.activeId}/acceptance`, { stage, command }),
    setBudget: budgetUsd => post(`/api/rooms/${state.activeId}/budget`, { budgetUsd }),
    verify: stage => post(`/api/rooms/${state.activeId}/verify`, { stage }),
    decideApproval: (id, decision) => post(`/api/rooms/${state.activeId}/approvals`, { id, decision }),
    addSeat: (role, name) => post(`/api/rooms/${state.activeId}/seats`, { role, name }),
    removeSeat: seatId => fetch(`/api/rooms/${state.activeId}/seats/${encodeURIComponent(seatId)}`, { method: 'DELETE' })
      .then(response => response.json().catch(() => ({})))
      .then(data => {
        if (data.error !== undefined) patch({ error: data.error })
        return data
      })
      .catch(error => {
        patch({ error: `移除席位失败：${String(error?.message ?? error)}` })
        return null
      }),
    pause: () => post(`/api/rooms/${state.activeId}/pause`, {}),
    resume: () => post(`/api/rooms/${state.activeId}/resume`, {}),
    stop: () => post(`/api/rooms/${state.activeId}/stop`, {}),
    parseTemplate: async (filename, text) => {
      const data = await post('/api/templates/parse', { filename, text })
      if (data?.template === undefined) return { ok: false, error: state.error ?? '模板解析失败' }
      return { ok: true, template: data.template }
    },
    loadProjectConstraints: async repoPath => {
      try {
        const response = await fetch(`/api/project/constraints?repoPath=${encodeURIComponent(repoPath)}`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
        return { ok: true, path: data.path ?? null, content: data.content ?? null, layers: data.layers ?? [] }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
    recommendRoster: async (goal, repoPath) => {
      const data = await post('/api/roster/recommend', { goal, repoPath })
      if (data?.proposal === undefined) return { ok: false, error: state.error ?? '编制建议失败' }
      return { ok: true, proposal: data.proposal }
    },
    createRoom: async (goal, answers = {}) => {
      const data = await post('/api/rooms', { goal, ...answers })
      if (data?.room === undefined) return { ok: false, error: state.error ?? '建房失败' }
      await load()
      patch({ activeId: data.room.id })
      return { ok: true, room: data.room, warning: data.warning ?? null }
    },
    exportHandoff: async () => {
      try {
        const response = await fetch(`/api/rooms/${state.activeId}/handoff`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data.bundle === undefined) throw new Error(data.error ?? `HTTP ${response.status}`)
        download(`${data.bundle.room?.id ?? 'room'}.lodge.json`, JSON.stringify(data.bundle, null, 2))
        patch({ error: null })
        return { ok: true }
      } catch (error) {
        patch({ error: `导出交接包失败：${String(error?.message ?? error)}` })
        return { ok: false }
      }
    },
    exportDelivery: async () => {
      try {
        const response = await fetch(`/api/rooms/${state.activeId}/delivery/export`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok || typeof data.text !== 'string') throw new Error(data.error ?? `HTTP ${response.status}`)
        download(data.filename ?? '交付单.md', data.text)
        patch({ error: null })
        return { ok: true }
      } catch (error) {
        patch({ error: `导出交付单失败：${String(error?.message ?? error)}` })
        return { ok: false }
      }
    },
    importHandoff,
    importHandoffFile: async file => {
      let bundle = null
      try {
        bundle = JSON.parse(await file.text())
      } catch {
        patch({ error: '交接包不是有效的 JSON' })
        return { ok: false }
      }
      return importHandoff(bundle)
    },
    dispatchAsk: text => post('/api/dispatch/requests', { text }),
    dispatchConfirm: id => post(`/api/dispatch/requests/${id}/confirm`, {}),
    dispatchDecline: id => post(`/api/dispatch/requests/${id}/decline`, {}),
    activeRoom,
  }
}

export function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
