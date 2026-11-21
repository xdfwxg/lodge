import { createElement as h, useEffect, useMemo, useState } from 'react'
import { createStore, useStore } from './store.js'
import { Sidebar } from './views/sidebar.js'
import { RoomView } from './views/room-view.js'
import { ProjectView } from './views/project-view.js'
import { LODGE_ROOM_ID } from '../../shared/lodge.js'
import { ProfileDialog } from './profile-dialog.js'
import { saveProfile } from './profile.js'
import { useProfileSync } from './app/use-profile-sync.js'
import { useAttention } from './app/use-attention.js'
import { onMenuCommand, onOpenRoom } from './system.js'
import { NewRoomDialog } from './new-room-dialog.js'
import { StatePanel } from './state-panel.js'
import { startupNoticeOf } from './app/startup.js'

export function App() {
  const store = useMemo(createStore, [])
  const state = useStore(store)
  const [profile, setProfile] = useProfileSync(store, state.profile)
  const [profileOpen, setProfileOpen] = useState(false)
  // 定时目标的 run 房是历史，不占侧栏和菜单；目标本身仍是同一行。
  const { visibleRooms, sidebarRooms, needsText } = useAttention(state.rooms)
  const [dialog, setDialog] = useState(false)
  const [seed, setSeed] = useState(null)
  const [startType, setStartType] = useState(null)
  const [projectId, setProjectId] = useState(null)
  const openDialog = (seedValue = null, roomType = null) => {
    setProjectId(null)
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

  const needsRegion = h('div', { className: 'visually-hidden', role: 'status', 'aria-live': 'polite' }, needsText)

  useEffect(() => {
    store.start()
    return () => store.disconnect()
  }, [store])

  const lodgeRoom = state.rooms.find(room => room.id === LODGE_ROOM_ID || room.lodge === true) ?? null

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
      const room = sidebarRooms.filter(item => !item.archivedAt)[Number(event.key) - 1]
      if (room === undefined) return
      event.preventDefault()
      setProjectId(null)
      store.select(room.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, lodgeRoom, sidebarRooms, store])

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
    onWorkspaceMemory: path => store.workspaceMemory(path),
    onReviewWorkspaceMemory: (path, memoryId, decision) => store.reviewWorkspaceMemory(path, memoryId, decision),
  })

  const room = state.rooms.find(item => item.id === state.activeId)
    ?? sidebarRooms.find(item => !item.archivedAt)
    ?? null

  const firstRun = state.rooms.length === 0
  const startup = startupNoticeOf(state)
  const retry = h('div', { className: 'crew-state-actions' },
    h('button', {
      type: 'button',
      className: 'crew-accept',
      onClick: () => void store.refresh(),
    }, '重试'))
  return h('div', { className: 'dsb-frame', 'data-solo': firstRun ? 'true' : undefined },
    connectionBanner,
    firstRun
      ? null
      : h(Sidebar, {
        state: { ...state, rooms: sidebarRooms },
        onSelect: id => {
          setProjectId(null)
          store.select(id)
        },
        onNew: () => openDialog(),
        lodgeRoom,
        profile,
        onProfile: () => setProfileOpen(true),
        onHoldMember: (memberId, held) => store.holdMember(memberId, held),
        onRename: (id, name) => store.renameRoom(id, name),
        onArchive: (id, archived) => store.archiveRoom(id, archived),
        onDelete: id => store.deleteRoom(id),
      }),
    projectId !== null
      ? h(ProjectView, {
        rooms: state.rooms,
        projects: state.projects ?? [],
        projectId,
        onClose: () => setProjectId(null),
        onOpenRoom: id => {
          setProjectId(null)
          store.select(id)
        },
        onStartRound: (roomId, text, options = {}) => store.startRound(text, { roomId, ...options }),
        onRecommend: (goal, repoPath, handoff) => store.recommendRoster(goal, repoPath, handoff),
      })
      : room === null
      ? h('main', { className: 'dsb-main crew-home' },
        h('div', { className: 'crew-home-inner' },
          h(StatePanel, {
            title: startup?.title ?? 'Lodge 正在准备…',
            body: startup?.body ?? null,
            tone: startup?.tone ?? 'neutral',
            action: startup?.retry ? retry : null,
          })))
      : h(RoomView, {
        state,
        room,
        store,
        onStartStudio: seedValue => openDialog(seedValue),
        onStartChat: seedValue => openDialog(seedValue, 'chat'),
        onOpenProject: id => setProjectId(id),
      }),
    liveRegion,
    needsRegion,
    dialogNode,
    h(ProfileDialog, {
      open: profileOpen,
      profile,
      onClose: () => setProfileOpen(false),
      onSave: next => {
        setProfile(saveProfile(next))
        void store.saveProfile(next)
      },
    }))
}
