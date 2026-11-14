import { Fragment, createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { createStore, useStore } from './store.js'
import { Sidebar } from './views/sidebar.js'
import { Onboarding } from './views/onboarding.js'
import { RoomView } from './views/room-view.js'
import { NewRoomDialog } from './new-room-dialog.js'

export function App() {
  const store = useMemo(createStore, [])
  const state = useStore(store)
  const [dialog, setDialog] = useState(false)
  const [resume, setResume] = useState(null)
  const [seed, setSeed] = useState(null)
  const openDialog = (room, seedValue = null) => {
    setResume(room ?? null)
    setSeed(seedValue)
    setDialog(true)
  }
  const closeDialog = () => {
    setDialog(false)
    setResume(null)
    setSeed(null)
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
    for (const room of state.rooms) {
      if (room.needsYou) next[room.id] = room.needsYou.label ?? room.needsYou.kind ?? '等你处理'
    }
    const prev = seenNeeds.current
    seenNeeds.current = next
    if (prev === null) return
    const changed = state.rooms.filter(room => room.needsYou && next[room.id] !== prev[room.id])
    if (changed.length === 0) return
    setNeedsText(changed.map(room => `${room.name}：${next[room.id]}`).join('；'))
  }, [state.rooms])
  const needsRegion = h('div', { className: 'visually-hidden', role: 'status', 'aria-live': 'polite' }, needsText)

  useEffect(() => {
    store.start()
    return () => store.disconnect()
  }, [store])

  const dialogNode = h(NewRoomDialog, {
    open: dialog,
    onClose: closeDialog,
    roomTypes: state.roomTypes ?? [],
    engines: state.engines ?? [],
    resume,
    seed,
    onCreate: (goal, answers) => store.createRoom(goal, answers),
    onRecommend: (goal, repoPath) => store.recommendRoster(goal, repoPath),
    onProjectConstraints: repoPath => store.loadProjectConstraints(repoPath),
  })

  if (state.rooms.length === 0) {
    return h(Fragment, null,
      h(Onboarding, {
        state,
        onCreate: () => openDialog(),
      }),
      liveRegion,
      needsRegion,
      dialogNode)
  }

  const room = state.rooms.find(item => item.id === state.activeId) ?? state.rooms[0]

  return h('div', { className: 'dsb-frame' },
    h(Sidebar, {
      state,
      onSelect: id => store.select(id),
      onNew: () => openDialog(),
    }),
    h(RoomView, {
      state,
      room,
      store,
      onContinue: openDialog,
      onStartStudio: seedValue => openDialog(null, seedValue),
    }),
    liveRegion,
    needsRegion,
    dialogNode)
}
