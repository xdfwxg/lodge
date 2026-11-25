import { useSyncExternalStore } from 'react'
import { humanErrorText } from './error-text.js'

const EMPTY = {
  phase: 'loading',
  rooms: [],
  projects: [],
  roles: [],
  roomTypes: [],
  engines: [],
  runtime: null,
  profile: null,
  activeId: null,
  error: null,
}

// 重连时用服务端快照补齐房间状态，但保留本地已经收到、可能比快照更新的消息。
const mergeMessages = (fresh = [], local = []) => {
  const byId = new Map()
  for (const message of fresh) byId.set(message.id, message)
  // 本地收到的流式消息可能比快照新；同 id 合并字段，缺的按 seq 补回中间那段。
  for (const message of local) byId.set(message.id, { ...(byId.get(message.id) ?? {}), ...message })
  return [...byId.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || (a.ts ?? 0) - (b.ts ?? 0))
}

export const mergeRoomSnapshot = (localRooms, freshRooms) => {
  const byId = new Map((localRooms ?? []).map(room => [room.id, room]))
  return (freshRooms ?? []).map(fresh => {
    const local = byId.get(fresh.id)
    return local === undefined ? fresh : { ...fresh, messages: mergeMessages(fresh.messages, local.messages) }
  })
}

export function createStore() {
  let state = EMPTY
  const failureText = fallback => (state.error === null || state.error === undefined ? fallback : humanErrorText(state.error, fallback))
  let source = null
  let runtimeTimer = null
  let stopped = false
  let launched = false
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
      ? state.rooms.map(item => (item.id === room.id
        ? {
          ...room,
          brief: room.brief ?? item.brief,
          rounds: room.rounds ?? item.rounds,
          messages: item.messages,
        }
        : item))
      : [...state.rooms, { ...room, messages: [] }]
    const order = new Map(state.rooms.map((item, index) => [item.id, index]))
    rooms.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
    patch({ rooms })
  }

  // 断线重连只补消息流，房间状态（阶段、交付）不会重放；重连后取一次快照。
  const refreshRooms = async () => {
    try {
      const response = await fetch('/api/state')
      if (!response.ok) return
      const data = await response.json()
      if (stopped) return
      const rooms = mergeRoomSnapshot(state.rooms, data.rooms)
      const activeId = state.activeId !== null && rooms.some(room => room.id === state.activeId)
        ? state.activeId
        : (rooms.find(room => !room.archivedAt)?.id ?? null)
      patch({
        rooms,
        projects: data.projects ?? state.projects,
        roles: data.roles ?? state.roles,
        roomTypes: data.roomTypes ?? state.roomTypes,
        engines: data.engines ?? state.engines,
        profile: data.profile ?? state.profile,
        activeId,
      })
    } catch {
      // 下一次重连会再试。
    }
  }

  const connect = () => {
    source?.close()
    const events = new EventSource(`/api/events?since=${lastSeq()}`)
    source = events
    events.addEventListener('open', () => {
      if (stopped) return
      const reconnected = state.phase === 'reconnecting'
      patch({ phase: 'live', error: null })
      if (reconnected) void refreshRooms()
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
    events.addEventListener('profile', event => {
      if (!stopped) patch({ profile: JSON.parse(event.data) })
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

  const lastAtOf = room => (room.messages ?? [])
    .reduce((max, message) => Math.max(max, message.ts ?? 0), 0) || room.completedAt || 0
  const isUnfinished = room => room !== null && room !== undefined && room.lodge !== true
    && (room.state === 'active' || room.state === 'paused')

  // /api/health 回答的是模型服务连上没有；Lodge 自己没响应时状态在请求这一层就断了。
  const readRuntime = async () => {
    try {
      const health = await fetch('/api/health')
      if (!health.ok) return { ok: false, error: `HTTP ${health.status}` }
      return (await health.json()).runtime ?? null
    } catch {
      return { ok: false, error: 'Lodge 服务没有响应' }
    }
  }
  const runtimeChanged = (before, after) => (before?.ok ?? null) !== (after?.ok ?? null)
    || String(before?.error ?? '') !== String(after?.error ?? '')

  // 模型服务断了会自己连回来；横幅不能只在打开页面时查一次，否则连上了还挂着旧话。
  const watchRuntime = () => {
    if (runtimeTimer !== null) return
    runtimeTimer = setInterval(async () => {
      if (stopped) return
      const runtime = await readRuntime()
      if (!stopped && runtimeChanged(state.runtime, runtime)) patch({ runtime })
    }, 20_000)
  }

  const load = async () => {
    try {
      const response = await fetch('/api/state')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      const runtime = await readRuntime()
      for (const room of data.rooms) for (const message of room.messages) seen.add(message.id)
      if (stopped) return
      const visible = data.rooms.filter(room => !room.archivedAt)
      const known = visible.some(room => room.id === state.activeId)
      const remembered = rememberedRoom()
      const rememberedRecord = visible.find(room => room.id === remembered) ?? null
      const lodgeRoom = visible.find(room => room.lodge === true) ?? null
      const unfinished = visible
        .filter(room => isUnfinished(room))
        .sort((a, b) => lastAtOf(b) - lastAtOf(a))
      // 第一次打开：有未完成的房就回房（先看上次那间），否则落在 Lodge。
      const launchId = isUnfinished(rememberedRecord)
        ? rememberedRecord.id
        : (unfinished[0]?.id ?? lodgeRoom?.id ?? visible[0]?.id ?? null)
      const activeId = launched
        ? (known ? state.activeId : (rememberedRecord?.id ?? visible[0]?.id ?? null))
        : launchId
      launched = true
      emit({
        ...state,
        phase: 'ready',
        rooms: mergeRoomSnapshot(state.rooms, data.rooms),
        projects: data.projects ?? [],
        roles: data.roles,
        roomTypes: data.roomTypes ?? [],
        engines: data.engines ?? [],
        profile: data.profile ?? state.profile,
        runtime,
        activeId,
        error: null,
      })
      connect()
      watchRuntime()
    } catch (error) {
      if (!stopped) patch({ phase: 'error', error: String(error?.message ?? error) })
    }
  }

  const post = async (path, body) => {
    try {
      // 桌面版把写操作交给主进程带上一次性令牌；浏览器调试仍走本机 HTTP。
      const bridge = globalThis.lodge?.request
      const response = typeof bridge === 'function'
        ? await bridge(path, body).then(result => ({
          ok: result?.ok === true,
          status: Number(result?.status ?? 0),
          json: async () => result?.body ?? {},
        }))
        : await fetch(path, {
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

  const get = async path => {
    try {
      const response = await fetch(path)
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}))
        throw new Error(detail.error ?? `HTTP ${response.status}`)
      }
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
      if (runtimeTimer !== null) {
        clearInterval(runtimeTimer)
        runtimeTimer = null
      }
      seen.clear()
    },
    select: activeId => (rememberRoom(activeId), patch({ activeId })),
    send: async (text, options = {}) => {
      const active = state.rooms.find(room => room.id === state.activeId) ?? null
      if (active?.lodge === true) {
        const data = await post(`/api/rooms/${active.id}/lodge`, {
          text,
          ...(Array.isArray(options.attachments) && options.attachments.length > 0 ? { attachments: options.attachments } : {}),
        })
        if (data?.createdRoom?.id !== undefined && data.createdRoom.id !== null) {
          await load()
          rememberRoom(data.createdRoom.id)
          patch({ activeId: data.createdRoom.id })
        }
        return data
      }
      return post(`/api/rooms/${state.activeId}/messages`, {
        text,
        ...(Array.isArray(options.mentions) && options.mentions.length > 0 ? { mentions: options.mentions } : {}),
        ...(Array.isArray(options.attachments) && options.attachments.length > 0 ? { attachments: options.attachments } : {}),
      })
    },
    // 当前用户资料是全局的：改名后所有房间和成员立即读到同一份。
    saveProfile: async input => {
      const data = await post('/api/profile', input)
      if (data?.profile !== undefined) patch({ profile: data.profile })
      await refreshRooms()
      return data
    },
    emailSettings: async () => {
      const data = await get('/api/settings/email')
      return data?.settings ?? null
    },
    saveEmailSettings: async input => {
      const data = await post('/api/settings/email', input)
      if (data?.settings === undefined) return { ok: false, error: state.error ?? '没保存上' }
      return { ok: true, settings: data.settings }
    },
    clearEmailSettings: async () => {
      const data = await post('/api/settings/email', { action: 'clear' })
      if (data?.settings === undefined) return { ok: false, error: state.error ?? '没断开' }
      return { ok: true, settings: data.settings }
    },
    testEmail: async input => {
      const data = await post('/api/settings/email', { action: 'test', ...input })
      if (data?.to === undefined) return { ok: false, error: state.error ?? '没发出去' }
      return { ok: true, to: data.to, id: data.id ?? '' }
    },
    // 已交付的工作室：不重回填表，直接把这句话变成下一轮的目标。
    startRound: async (text, options = {}) => {
      const roomId = options.roomId ?? state.activeId
      const data = await post(`/api/rooms/${roomId}/rounds`, {
        text,
        ...(typeof options.projectId === 'string' && options.projectId !== '' ? { projectId: options.projectId } : {}),
        ...(Array.isArray(options.attachments) && options.attachments.length > 0 ? { attachments: options.attachments } : {}),
        ...(options.plan !== null && typeof options.plan === 'object' ? { plan: options.plan } : {}),
      })
      if (data?.room?.id !== undefined && data.room.id !== null) {
        await load()
        rememberRoom(data.room.id)
        patch({ activeId: data.room.id })
      }
      return data
    },
    // 旧轮只读：按轮取回它自己的消息，不碰当前轮。
    loadRound: (roomId, roundId) => get(`/api/rooms/${roomId}/rounds/${roundId}`),
    // 附件先上传，再随消息发送；图片在消息里显示缩略图，文本文件把正文带给模型。
    uploadAttachment: async file => {
      try {
        const response = await fetch(`/api/attachments?name=${encodeURIComponent(file?.name ?? 'file')}`, {
          method: 'POST',
          headers: { 'content-type': file?.type || 'application/octet-stream' },
          body: file,
        })
        const data = await response.json().catch(() => null)
        if (!response.ok || data?.attachment === undefined) {
          return { ok: false, error: data?.error ?? '这个文件没能传上去' }
        }
        return { ok: true, attachment: { ...data.attachment, title: data.attachment.title ?? file.name } }
      } catch {
        return { ok: false, error: '这个文件没能传上去' }
      }
    },
    markRead: () => post(`/api/rooms/${state.activeId}/read`, {}),
    holdMember: (memberId, held) => post(`/api/rooms/${state.activeId}/hold`, { memberId, held }),
    cancelQueued: queueId => post(`/api/rooms/${state.activeId}/cancel-queue`, { queueId }),
    steerQueued: queueId => post(`/api/rooms/${state.activeId}/steer`, { queueId }),
    answerDecision: async (decisionId, optionId, text = '') => {
      const data = await post(`/api/rooms/${state.activeId}/decision`, {
        decisionId,
        optionId,
        ...(typeof text === 'string' && text.trim() !== '' ? { text } : {}),
      })
      if (data?.room !== undefined) acceptRoom(data.room)
      return data
    },
    humanChoice: (stage, choice, note = '') => post(`/api/rooms/${state.activeId}/human-choice`, { stage, choice, note }),
    rework: (stage, note) => post(`/api/rooms/${state.activeId}/rework`, { stage, note }),
    resolveMerge: async () => {
      const data = await post(`/api/rooms/${state.activeId}/resolve-merge`, {})
      if (data?.room === undefined) return { ok: false, error: failureText('冲突还没解决完') }
      acceptRoom(data.room)
      return { ok: true }
    },
    retry: (stage, note) => post(`/api/rooms/${state.activeId}/retry`, { stage, note }),
    continueChat: note => post(`/api/rooms/${state.activeId}/chat-continue`, { note }),
    resumeChat: () => post(`/api/rooms/${state.activeId}/chat-resume`, {}),
    reviewChatConclusion: conclusionId => post(`/api/rooms/${state.activeId}/chat-review`, { conclusionId }),
    resumeRoom: () => post(`/api/rooms/${state.activeId}/resume`, {}),
    interruptRoom: () => post(`/api/rooms/${state.activeId}/interrupt`, {}),
    verify: stage => post(`/api/rooms/${state.activeId}/verify`, { stage }),
    decideApproval: (id, decision) => post(`/api/rooms/${state.activeId}/approvals`, { id, decision }),
    answerCard: (memberId, requestId, message) => post(`/api/rooms/${state.activeId}/answer-card`, { memberId, requestId, message }),

    createRoom: async (goal, answers = {}) => {
      const data = await post('/api/rooms', { goal, ...answers })
      if (data?.room === undefined) return { ok: false, error: failureText('房间没能建起来') }
      await load()
      rememberRoom(data.room.id)
      patch({ activeId: data.room.id })
      return { ok: true, room: data.room, warning: data.warning ?? null }
    },
    renameRoom: async (id, name) => {
      const data = await post(`/api/rooms/${id}/rename`, { name })
      if (data?.room === undefined) return { ok: false, error: failureText('名字没能改过来') }
      await load()
      return { ok: true, room: data.room }
    },
    archiveRoom: async (id, archived = true) => {
      const data = await post(`/api/rooms/${id}/archive`, { archived })
      if (data?.room === undefined) {
        return { ok: false, error: failureText(archived ? '没能归档' : '没能取消归档') }
      }
      await load()
      return { ok: true, room: data.room }
    },
    deleteRoom: async id => {
      const data = await post(`/api/rooms/${id}/delete`, {})
      if (data?.id === undefined) return { ok: false, error: failureText('没能删除') }
      await load()
      return { ok: true, id: data.id }
    },
    addMember: async (name, role, engine, model, spec = {}) => {
      const data = await post(`/api/rooms/${state.activeId}/add-member`, { name, role, engine, model, ...spec })
      if (data?.room === undefined) return { ok: false, error: failureText('没能添加成员') }
      acceptRoom(data.room)
      return { ok: true, room: data.room }
    },
    removeMember: async memberId => {
      const data = await post(`/api/rooms/${state.activeId}/remove-member`, { memberId })
      if (data?.room === undefined) return { ok: false, error: failureText('没能移除成员') }
      acceptRoom(data.room)
      return { ok: true, room: data.room }
    },
    swapBody: async (memberId, engine, model, spec = {}) => {
      const data = await post(`/api/rooms/${state.activeId}/swap-body`, { memberId, engine, model, ...spec })
      if (data?.room === undefined) return { ok: false, error: failureText('没能保存') }
      acceptRoom(data.room)
      return { ok: true, room: data.room }
    },
    activeRoom,
    readArtifact: (roomId, path) => get(`/api/rooms/${roomId}/artifact?path=${encodeURIComponent(path)}`),
    workspaceMemory: async path => {
      const data = await get(`/api/workspace/memory?path=${encodeURIComponent(path)}`)
      return Array.isArray(data?.entries) ? data.entries : null
    },
    reviewWorkspaceMemory: async (path, memoryId, decision) => {
      const data = await post('/api/workspace/memory/review', { path, memoryId, decision })
      return Array.isArray(data?.entries) ? data.entries : null
    },
    forgetMemory: async () => {
      const data = await post(`/api/rooms/${state.activeId}/memory/opt-out`, {})
      if (data?.room === undefined) return { ok: false }
      acceptRoom(data.room)
      return { ok: true }
    },
    createPromise: async input => {
      const data = await post(`/api/rooms/${state.activeId}/promise`, input)
      if (data?.room !== undefined) acceptRoom(data.room)
      return data
    },
    updatePromise: async input => {
      const data = await post(`/api/rooms/${state.activeId}/promise-update`, input)
      if (data?.room === undefined) return { ok: false, error: state.error ?? '没保存上' }
      acceptRoom(data.room)
      return { ok: true, room: data.room }
    },
    runPromise: () => post(`/api/rooms/${state.activeId}/promise-run`, {}),
    refresh: load,
  }
}

export function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
