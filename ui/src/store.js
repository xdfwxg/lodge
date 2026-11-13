import { useSyncExternalStore } from 'react'

const EMPTY = {
  phase: 'loading',
  rooms: [],
  seats: [],
  roomTypes: [],
  engines: [],
  runtime: null,
  budget: null,
  review: null,
  reviewFor: null,
  replay: null,
  replayFor: null,
  shadow: null,
  shadowFor: null,
  shadowFocus: null,
  ledger: null,
  ledgerFor: null,
  integrity: null,
  integrityFor: null,
  activeId: null,
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
  const rememberedRoom = () => {
    try {
      return globalThis.localStorage?.getItem('lodge.activeRoom') ?? null
    } catch {
      return null
    }
  }
  const rememberRoom = id => {
    try {
      globalThis.localStorage?.setItem('lodge.activeRoom', id)
    } catch {
      // 隐私模式或禁用存储时只影响下次落在哪个房间，不影响使用。
    }
  }

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
      const known = data.rooms.some(room => room.id === state.activeId)
      const remembered = rememberedRoom()
      const activeId = known
        ? state.activeId
        : (data.rooms.some(room => room.id === remembered) ? remembered : (data.rooms[0]?.id ?? null))
      emit({
        ...state,
        phase: 'ready',
        rooms: data.rooms,
        seats: data.seats,
        roomTypes: data.roomTypes ?? [],
        engines: data.engines ?? [],
        runtime,
        budget: data.budget ?? null,
        activeId,
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

  const openReplay = async roomId => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/transitions`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.transitions === undefined) throw new Error(data.error ?? `HTTP ${response.status}`)
      patch({ replay: data.transitions, replayFor: roomId, error: null })
    } catch (error) {
      patch({ error: `状态回放加载失败：${String(error?.message ?? error)}` })
    }
  }

  const openShadow = async (roomId, evidenceId = null) => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/shadow-review`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.shadowReview === undefined) throw new Error(data.error ?? `HTTP ${response.status}`)
      patch({ shadow: data.shadowReview, shadowFor: roomId, shadowFocus: evidenceId, error: null })
    } catch (error) {
      patch({ error: `评审对照加载失败：${String(error?.message ?? error)}` })
    }
  }

  const openLedger = async roomId => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/evidence-ledger`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ledger === undefined) throw new Error(data.error ?? `HTTP ${response.status}`)
      patch({ ledger: data.ledger, ledgerFor: roomId, error: null })
    } catch (error) {
      patch({ error: `证据账本加载失败：${String(error?.message ?? error)}` })
    }
  }

  const verifyLedger = async roomId => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/evidence-integrity`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.integrity === undefined) throw new Error(data.error ?? `HTTP ${response.status}`)
      patch({ integrity: data.integrity, integrityFor: roomId, error: null })
    } catch (error) {
      patch({ error: `账本校验失败：${String(error?.message ?? error)}` })
    }
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
    select: activeId => (rememberRoom(activeId), patch({
      activeId,
      review: null,
      reviewFor: null,
      replay: null,
      replayFor: null,
      shadow: null,
      shadowFor: null,
      shadowFocus: null,
      ledger: null,
      ledgerFor: null,
      integrity: null,
      integrityFor: null,
    })),
    resetMcp: server => post(`/api/rooms/${state.activeId}/mcp/reset`, { server }),
    openReview,
    closeReview: () => patch({ review: null, reviewFor: null }),
    openReplay,
    closeReplay: () => patch({ replay: null, replayFor: null }),
    openShadow,
    closeShadow: () => patch({ shadow: null, shadowFor: null, shadowFocus: null }),
    openLedger,
    verifyLedger,
    send: text => post(`/api/rooms/${state.activeId}/messages`, { text }),
    markRead: () => post(`/api/rooms/${state.activeId}/read`, {}),
    accept: stage => post(`/api/rooms/${state.activeId}/accept`, { stage }),
    chatAccept: () => post(`/api/rooms/${state.activeId}/chat-accept`, {}),
    rework: (stage, note) => post(`/api/rooms/${state.activeId}/rework`, { stage, note }),
    continueChat: note => post(`/api/rooms/${state.activeId}/chat-continue`, { note }),
    resumeChat: () => post(`/api/rooms/${state.activeId}/chat-resume`, {}),
    createSubroom: goal => post(`/api/rooms/${state.activeId}/subrooms`, { goal }),
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
    setTrust: (level, reason) => post(`/api/rooms/${state.activeId}/trust`, { level, reason }),
    verify: stage => post(`/api/rooms/${state.activeId}/verify`, { stage }),
    decideApproval: (id, decision) => post(`/api/rooms/${state.activeId}/approvals`, { id, decision }),
    editStagePlan: (action, index, stage) => post(`/api/rooms/${state.activeId}/stages`, { action, index, stage }),
    pause: () => post(`/api/rooms/${state.activeId}/pause`, {}),
    resume: () => post(`/api/rooms/${state.activeId}/resume`, {}),
    stop: () => post(`/api/rooms/${state.activeId}/stop`, {}),
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
      rememberRoom(data.room.id)
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
    activeRoom,
  }
}

export function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
