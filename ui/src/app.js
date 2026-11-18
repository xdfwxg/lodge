import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { createStore, useStore } from './store.js'
import { Sidebar } from './views/sidebar.js'
import { RoomView } from './views/room-view.js'
import { HomeView } from './views/home.js'
import { NewRoomDialog } from './new-room-dialog.js'

export function App() {
  const store = useMemo(createStore, [])
  const state = useStore(store)
  const visibleRooms = state.rooms.filter(room => !room.archivedAt)
  const [dialog, setDialog] = useState(false)
  const [seed, setSeed] = useState(null)
  const [startType, setStartType] = useState(null)
  const openDialog = (seedValue = null, roomType = null) => {
    setSeed(seedValue)
    setStartType(roomType)
    setDialog(true)
  }
  const closeDialog = () => {
    setDialog(false)
    setSeed(null)
    setStartType(null)
  }

  const liveText = state.phase === 'reconnecting'
    ? '连接中断，正在重连'
    : state.phase === 'loading' ? '正在加载' : ''
  const liveRegion = h('div', { className: 'visually-hidden', role: 'status', 'aria-live': 'polite' }, liveText)
  const connectionBanner = state.phase === 'reconnecting'
    ? h('div', { className: 'crew-connection-banner', role: 'status' }, '连接中断，正在重连…')
    : null

  // Announce a room's needs-you signal only when it appears or changes, so
  // per-message store updates never flood the region.
  const [needsText, setNeedsText] = useState('')
  const seenNeeds = useRef(null)
  useEffect(() => {
    const next = {}
    for (const room of visibleRooms) {
      if (room.needsYou) next[room.id] = room.needsYou.label ?? room.needsYou.kind ?? '待处理'
    }
    const prev = seenNeeds.current
    seenNeeds.current = next
    const count = Object.keys(next).length
    if (prev === null) {
      window.lodge?.attention?.({ count })
      return
    }
    const changed = visibleRooms.filter(room => room.needsYou && next[room.id] !== prev[room.id])
    const appearing = visibleRooms.filter(room => room.needsYou && prev[room.id] === undefined)
    if (appearing.length > 0) {
      const room = appearing[0]
      window.lodge?.attention?.({
        count,
        notify: { roomId: room.id, title: 'Lodge 需要你', body: `${room.name}：${next[room.id]}` },
      })
    } else if (count !== Object.keys(prev).length) {
      window.lodge?.attention?.({ count })
    }
    if (changed.length === 0) return
    setNeedsText(changed.map(room => `${room.name}：${next[room.id]}`).join('；'))
  }, [state.rooms])

  // 房间菜单只显示前 9 个；名字或顺序变了才重发，避免每条消息都重建菜单。
  const menuSignature = visibleRooms.slice(0, 9)
    .map(room => `${room.id}\u0000${room.name ?? ''}`)
    .join('\n')
  useEffect(() => {
    window.lodge?.syncRooms?.(visibleRooms.slice(0, 9).map(room => ({ id: room.id, name: room.name ?? '' })))
  }, [menuSignature])

  useEffect(() => {
    const offCommand = window.lodge?.onCommand?.(name => {
      if (name === 'new-room') {
        setSeed(null)
        setStartType(null)
        setDialog(true)
      }
      if (name === 'search') window.dispatchEvent(new Event('lodge:focus-search'))
    })
    const offOpenRoom = window.lodge?.onOpenRoom?.(id => {
      if (typeof id === 'string') store.select(id)
    })
    return () => {
      offCommand?.()
      offOpenRoom?.()
    }
  }, [store])
  const needsRegion = h('div', { className: 'visually-hidden', role: 'status', 'aria-live': 'polite' }, needsText)

  useEffect(() => {
    store.start()
    return () => store.disconnect()
  }, [store])

  // 没有房间时停在门口：写下目标就直接开工，团队和工作区由 Lodge 准备。
  // 准备失败（例如没有可用模型）才退回建房对话框，让人调整。
  const openFromHome = async goal => {
    const result = await store.createRoom(goal, { verify: 'manual' })
    if (result?.ok !== true) openDialog({ goal })
  }

  // macOS 惯例：⌘N 新房间，⌘1..9 切房间；弹窗打开时不抢键。
  useEffect(() => {
    const onKeyDown = event => {
      if (event.defaultPrevented || dialog) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        openDialog()
        return
      }
      if (!/^[1-9]$/.test(event.key)) return
      const room = visibleRooms[Number(event.key) - 1]
      if (room === undefined) return
      event.preventDefault()
      store.select(room.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, visibleRooms, store])

  const dialogNode = h(NewRoomDialog, {
    open: dialog,
    onClose: closeDialog,
    roomTypes: state.roomTypes ?? [],
    engines: state.engines ?? [],
    features: state.features,
    seed,
    onRefresh: () => store.refresh(),
    startType,
    onCreate: (goal, answers) => store.createRoom(goal, answers),
    onRecommend: (goal, repoPath, handoff) => store.recommendRoster(goal, repoPath, handoff),
  })

  const room = visibleRooms.find(item => item.id === state.activeId) ?? visibleRooms[0] ?? null

  const firstRun = state.rooms.length === 0
  return h('div', { className: 'dsb-frame', 'data-solo': firstRun ? 'true' : undefined },
    connectionBanner,
    firstRun
      ? null
      : h(Sidebar, {
        state,
        onSelect: id => store.select(id),
        onNew: () => openDialog(),
        onRename: (id, name) => store.renameRoom(id, name),
        onArchive: (id, archived) => store.archiveRoom(id, archived),
        onDelete: id => store.deleteRoom(id),
      }),
    room === null
      ? h(HomeView, {
        onSubmit: openFromHome,
        onSample: () => { void store.openSampleRoom() },
        onAdjust: goal => openDialog({ goal }),
        error: state.error,
      })
      : h(RoomView, {
        state,
        room,
        store,
        onStartStudio: seedValue => openDialog(seedValue),
        onStartChat: seedValue => openDialog(seedValue, 'chat'),
      }),
    liveRegion,
    needsRegion,
    dialogNode)
}
