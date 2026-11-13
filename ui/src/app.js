import { Fragment, createElement as h, useEffect, useMemo, useState } from 'react'
import { createStore, useStore } from './store.js'
import { Sidebar } from './views/sidebar.js'
import { Onboarding } from './views/onboarding.js'
import { DispatchView } from './views/dispatch-view.js'
import { RoomView } from './views/room-view.js'
import { NewRoomDialog } from './new-room-dialog.js'

export function App() {
  const store = useMemo(createStore, [])
  const state = useStore(store)
  const [dialog, setDialog] = useState(false)
  const [resume, setResume] = useState(null)
  const openDialog = room => {
    setResume(room ?? null)
    setDialog(true)
  }
  const closeDialog = () => {
    setDialog(false)
    setResume(null)
  }

  useEffect(() => {
    store.start()
    return () => store.disconnect()
  }, [store])

  const dialogNode = h(NewRoomDialog, {
    open: dialog,
    onClose: closeDialog,
    roomTypes: state.roomTypes ?? [],
    roomTemplates: state.roomTemplates ?? [],
    engines: state.engines ?? [],
    resume,
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
      dialogNode)
  }

  const room = state.rooms.find(item => item.id === state.activeId) ?? null
  const isDispatch = state.activeId === 'dispatch' || room === null

  return h('div', { className: 'dsb-frame' },
    h(Sidebar, {
      state,
      onSelect: id => store.select(id),
      onNew: () => openDialog(),
    }),
    isDispatch
      ? h(DispatchView, { state, store })
      : h(RoomView, { state, room, store, onContinue: openDialog }),
    dialogNode)
}
