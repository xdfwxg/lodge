import { Fragment, createElement as h, useEffect, useMemo, useState } from 'react'
import { createStore, useStore } from './store.js'
import { Sidebar } from './views/sidebar.js'
import { Onboarding } from './views/onboarding.js'
import { DispatchView } from './views/dispatch-view.js'
import { UsageView } from './views/usage-view.js'
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
    templates: state.templates ?? [],
    roomTypes: state.roomTypes ?? [],
    savedTemplates: state.savedTemplates ?? [],
    onSaveTemplate: (filename, text) => store.saveTemplate(filename, text),
    resume,
    onCreate: (goal, answers) => store.createRoom(goal, answers),
    onRecommend: (goal, repoPath) => store.recommendRoster(goal, repoPath),
    onProjectConstraints: repoPath => store.loadProjectConstraints(repoPath),
    onParseTemplate: (filename, text) => store.parseTemplate(filename, text),
  })

  if (state.rooms.length === 0) {
    return h(Fragment, null,
      h(Onboarding, {
        state,
        onCreate: () => openDialog(),
        onImport: file => store.importHandoffFile(file),
      }),
      dialogNode)
  }

  const room = state.rooms.find(item => item.id === state.activeId) ?? null
  const isUsage = state.activeId === 'usage'
  const isDispatch = !isUsage && (state.activeId === 'dispatch' || room === null)

  return h('div', { className: 'dsb-frame' },
    h(Sidebar, {
      state,
      onSelect: id => store.select(id),
      onNew: () => openDialog(),
      onImport: file => store.importHandoffFile(file),
    }),
    isUsage
      ? h(UsageView, { state, store })
      : isDispatch
        ? h(DispatchView, { state, store })
        : h(RoomView, { state, room, store, onContinue: openDialog }),
    dialogNode)
}
