import { useSyncExternalStore } from 'react'

const EMPTY = {
  phase: 'loading',
  rooms: [],
  dispatch: null,
  seats: [],
  templates: [],
  runtime: null,
  budget: null,
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
    select: activeId => patch({ activeId }),
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
    pause: () => post(`/api/rooms/${state.activeId}/pause`, {}),
    resume: () => post(`/api/rooms/${state.activeId}/resume`, {}),
    stop: () => post(`/api/rooms/${state.activeId}/stop`, {}),
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
    dispatchAsk: text => post('/api/dispatch/requests', { text }),
    dispatchConfirm: id => post(`/api/dispatch/requests/${id}/confirm`, {}),
    dispatchDecline: id => post(`/api/dispatch/requests/${id}/decline`, {}),
    activeRoom,
  }
}

export function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
