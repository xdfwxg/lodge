import { useSyncExternalStore } from 'react'

const EMPTY = {
  phase: 'loading',
  rooms: [],
  seats: [],
  roomTypes: [],
  engines: [],
  runtime: null,
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
  const lastSeq = () => Math.max(0, ...state.rooms.flatMap(room => room.messages.map(message => message.seq ?? 0)))
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
        ? {
          ...room,
          // 按消息时间排；seq 只是本地落库顺序，流式占位和最终消息会乱序。
          messages: [...room.messages, message].sort((a, b) => (
            (a.ts ?? 0) - (b.ts ?? 0) || (a.seq ?? 0) - (b.seq ?? 0)
          )),
        }
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
    patch({ rooms })
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
    events.addEventListener('room.deleted', event => {
      if (stopped) return
      const { id } = JSON.parse(event.data)
      const rooms = state.rooms.filter(room => room.id !== id)
      const visible = rooms.filter(room => !room.archivedAt)
      patch({ rooms, activeId: state.activeId === id ? (visible[0]?.id ?? null) : state.activeId })
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
        runtime = { ok: false, error: 'Lodge 服务没有响应' }
      }
      for (const room of data.rooms) for (const message of room.messages) seen.add(message.id)
      if (stopped) return
      const visible = data.rooms.filter(room => !room.archivedAt)
      const known = visible.some(room => room.id === state.activeId)
      const remembered = rememberedRoom()
      const activeId = known
        ? state.activeId
        : (visible.some(room => room.id === remembered) ? remembered : (visible[0]?.id ?? null))
      emit({
        ...state,
        phase: 'ready',
        rooms: data.rooms,
        seats: data.seats,
        roomTypes: data.roomTypes ?? [],
        engines: data.engines ?? [],
        runtime,
        activeId,
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
    select: activeId => (rememberRoom(activeId), patch({ activeId })),
    send: text => post(`/api/rooms/${state.activeId}/messages`, { text }),
    markRead: () => post(`/api/rooms/${state.activeId}/read`, {}),
    holdSeat: (seat, held) => post(`/api/rooms/${state.activeId}/hold`, { seat, held }),
    accept: stage => post(`/api/rooms/${state.activeId}/accept`, { stage }),
    chatAccept: () => post(`/api/rooms/${state.activeId}/chat-accept`, {}),
    rework: (stage, note) => post(`/api/rooms/${state.activeId}/rework`, { stage, note }),
    continueChat: note => post(`/api/rooms/${state.activeId}/chat-continue`, { note }),
    resumeChat: () => post(`/api/rooms/${state.activeId}/chat-resume`, {}),
    answer: async (stage, text) => {
      if (text !== '') {
        const sent = await post(`/api/rooms/${state.activeId}/messages`, { text })
        if (sent === null) return null
      }
      return post(`/api/rooms/${state.activeId}/accept`, { stage })
    },
    setAcceptance: (stage, command) => post(`/api/rooms/${state.activeId}/acceptance`, { stage, command }),
    verify: stage => post(`/api/rooms/${state.activeId}/verify`, { stage }),
    decideApproval: (id, decision) => post(`/api/rooms/${state.activeId}/approvals`, { id, decision }),
    createSubroom: async goal => {
      const data = await post(`/api/rooms/${state.activeId}/subrooms`, { goal })
      if (data?.room === undefined) return { ok: false, error: state.error ?? '子房间没能建起来' }
      await load()
      return { ok: true, room: data.room }
    },

    recommendRoster: async (goal, repoPath, handoff) => {
      const data = await post('/api/roster/recommend', {
        goal,
        repoPath,
        ...(handoff === null || handoff === undefined ? {} : { handoff }),
      })
      if (data?.proposal === undefined) return { ok: false, error: state.error ?? 'Lodge 没有给出方案' }
      return { ok: true, proposal: data.proposal }
    },
    createRoom: async (goal, answers = {}) => {
      const data = await post('/api/rooms', { goal, ...answers })
      if (data?.room === undefined) return { ok: false, error: state.error ?? '房间没能建起来' }
      await load()
      rememberRoom(data.room.id)
      patch({ activeId: data.room.id })
      return { ok: true, room: data.room, warning: data.warning ?? null }
    },
    openSampleRoom: async () => {
      const data = await post('/api/rooms/sample', {})
      if (data?.room === undefined) return { ok: false, error: state.error ?? '示例房间没能打开' }
      await load()
      rememberRoom(data.room.id)
      patch({ activeId: data.room.id })
      return { ok: true, room: data.room }
    },
    renameRoom: async (id, name) => {
      const data = await post(`/api/rooms/${id}/rename`, { name })
      if (data?.room === undefined) return { ok: false, error: state.error ?? '名字没能改过来' }
      await load()
      return { ok: true, room: data.room }
    },
    archiveRoom: async (id, archived = true) => {
      const data = await post(`/api/rooms/${id}/archive`, { archived })
      if (data?.room === undefined) {
        return { ok: false, error: state.error ?? (archived ? '没能归档' : '没能取消归档') }
      }
      await load()
      return { ok: true, room: data.room }
    },
    deleteRoom: async id => {
      const data = await post(`/api/rooms/${id}/delete`, {})
      if (data?.id === undefined) return { ok: false, error: state.error ?? '没能删除' }
      await load()
      return { ok: true, id: data.id }
    },
    activeRoom,
  }
}

export function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
