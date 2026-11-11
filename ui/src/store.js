import { useSyncExternalStore } from 'react'

const EMPTY = { phase: 'loading', room: null, seats: [], messages: [], error: null }

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
  const lastSeq = () => state.messages.at(-1)?.seq ?? 0

  const acceptMessage = message => {
    if (seen.has(message.id)) return
    seen.add(message.id)
    patch({ messages: [...state.messages, message].sort((a, b) => a.seq - b.seq) })
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
    events.addEventListener('room', event => {
      if (!stopped) patch({ room: JSON.parse(event.data) })
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
      for (const message of data.messages) seen.add(message.id)
      if (stopped) return
      emit({ phase: 'ready', room: data.room, seats: data.seats, messages: data.messages, error: null })
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
      return true
    } catch (error) {
      patch({ error: String(error?.message ?? error) })
      return false
    }
  }

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
    stop: () => {
      stopped = true
      source?.close()
      source = null
      seen.clear()
    },
    send: text => post('/api/messages', { text }),
    accept: stage => post('/api/accept', { stage }),
  }
}

export function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
