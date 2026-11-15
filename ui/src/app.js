import { Fragment, createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { createStore, useStore } from './store.js'
import { Onboarding } from './views/onboarding.js'
import { Sidebar } from './views/sidebar.js'
import { RoomView } from './views/room-view.js'
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
    if (prev === null) return
    const changed = visibleRooms.filter(room => room.needsYou && next[room.id] !== prev[room.id])
    if (changed.length === 0) return
    setNeedsText(changed.map(room => `${room.name}：${next[room.id]}`).join('；'))
  }, [state.rooms])
  const needsRegion = h('div', { className: 'visually-hidden', role: 'status', 'aria-live': 'polite' }, needsText)

  useEffect(() => {
    store.start()
    return () => store.disconnect()
  }, [store])

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
    seed,
    startType,
    onCreate: (goal, answers) => store.createRoom(goal, answers),
    onRecommend: (goal, repoPath) => store.recommendRoster(goal, repoPath),
  })

  if (visibleRooms.length === 0) {
    return h(Fragment, null,
      h(Onboarding, {
        state,
        onCreate: roomType => openDialog(null, roomType),
      }),
      liveRegion,
      needsRegion,
      dialogNode)
  }

  const room = visibleRooms.find(item => item.id === state.activeId) ?? visibleRooms[0]

  return h('div', { className: 'dsb-frame' },
    h(Sidebar, {
      state,
      onSelect: id => store.select(id),
      onNew: () => openDialog(),
      onRename: (id, name) => store.renameRoom(id, name),
      onArchive: (id, archived) => store.archiveRoom(id, archived),
      onDelete: id => store.deleteRoom(id),
    }),
    h(RoomView, {
      state,
      room,
      store,
      onStartStudio: seedValue => openDialog(seedValue),
    }),
    liveRegion,
    needsRegion,
    dialogNode)
}
