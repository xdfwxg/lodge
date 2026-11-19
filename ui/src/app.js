import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { createStore, useStore } from './store.js'
import { Sidebar } from './views/sidebar.js'
import { RoomView } from './views/room-view.js'
import { HomeView } from './views/home.js'
import { NewRoomDialog } from './new-room-dialog.js'
import { NewGoalDialog } from './new-goal-dialog.js'

export function App() {
  const store = useMemo(createStore, [])
  const state = useStore(store)
  // 定时目标的 run 房是历史，不占侧栏和菜单；目标本身仍是同一行。
  // 但 run 停下来等人时仍要提醒，否则目标会在后台无声卡住。
  const attentionRooms = useMemo(() => {
    const byId = new Map(state.rooms.map(room => [room.id, room]))
    return state.rooms.filter(room => {
      if (room.archivedAt) return false
      if (room.routineRun !== true) return true
      const goal = byId.get(room.routineGoalId)
      return goal === undefined || goal === null ||
        (goal.archivedAt !== undefined && goal.archivedAt !== null)
    })
  }, [state.rooms])
  const visibleRooms = useMemo(() => attentionRooms.filter(room => room.routineRun !== true), [attentionRooms])
  const sidebarRooms = useMemo(() => state.rooms.filter(room => room.routineRun !== true), [state.rooms])
  const [dialog, setDialog] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)
  const [seed, setSeed] = useState(null)
  const [startType, setStartType] = useState(null)
  const openDialog = (seedValue = null, roomType = null) => {
    setGoalOpen(false)
    setSeed(seedValue)
    setStartType(roomType)
    setDialog(true)
  }
  const closeDialog = () => {
    setDialog(false)
    setSeed(null)
    setStartType(null)
  }
  const openGoal = () => {
    setDialog(false)
    setSeed(null)
    setStartType(null)
    setGoalOpen(true)
  }
  const closeGoal = () => setGoalOpen(false)

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
    for (const room of attentionRooms) {
      if (room.needsYou) {
        next[room.id] = room.needsYou.reason ?? room.needsYou.label ?? room.needsYou.kind ?? '待处理'
      }
    }
    const prev = seenNeeds.current
    seenNeeds.current = next
    const count = Object.keys(next).length
    if (prev === null) {
      window.lodge?.attention?.({ count })
      return
    }
    const changed = attentionRooms.filter(room => room.needsYou && next[room.id] !== prev[room.id])
    const appearing = attentionRooms.filter(room => room.needsYou && prev[room.id] === undefined)
    if (appearing.length > 0) {
      const room = appearing[0]
      const result = room.needsYou?.kind === 'result'
      const run = room.needsYou?.kind === 'routine-run'
      window.lodge?.attention?.({
        count,
        notify: {
          roomId: room.id,
          title: result ? 'Lodge' : 'Lodge 需要你',
          body: result
            ? `「${room.name}」的结果好了`
            : run
              ? `「${room.name}」${room.needsYou.label ?? '这次需要你'}：${room.needsYou.reason ?? '需要处理'}`
              : `${room.name}：${next[room.id]}`,
        },
      })
    } else if (count !== Object.keys(prev).length) {
      window.lodge?.attention?.({ count })
    }
    if (changed.length === 0) return
    setNeedsText(changed.map(room => `${room.name}：${next[room.id]}`).join('；'))
  }, [attentionRooms])

  // 房间菜单只显示前 9 个；名字或顺序变了才重发，避免每条消息都重建菜单。
  const menuSignature = visibleRooms.slice(0, 9)
    .map(room => `${room.id}\u0000${room.name ?? ''}`)
    .join('\n')
  useEffect(() => {
    window.lodge?.syncRooms?.(visibleRooms.slice(0, 9).map(room => ({ id: room.id, name: room.name ?? '' })))
  }, [menuSignature])

  useEffect(() => {
    const offCommand = window.lodge?.onCommand?.(name => {
      if (name === 'new-room') openGoal()
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

  // 写下目标就直接开工，团队和工作区由 Lodge 准备。准备失败（例如没有可用模型）
  // 才退回完整建房对话框，让人调整；目标不会丢。
  const startGoal = async goal => {
    const result = await store.createRoom(goal, { verify: 'manual' })
    if (result?.ok === true) {
      setGoalOpen(false)
      return result
    }
    openDialog({ goal }, 'studio')
    return result
  }
  const discussGoal = goal => openDialog(goal === '' ? null : { goal }, 'chat')
  const adjustGoal = goal => openDialog(goal === '' ? null : { goal }, 'studio')

  // macOS 惯例：⌘N 新房间，⌘1..9 切房间；弹窗打开时不抢键。
  useEffect(() => {
    const onKeyDown = event => {
      if (event.defaultPrevented || dialog || goalOpen) return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        openGoal()
        return
      }
      if (!/^[1-9]$/.test(event.key)) return
      const room = sidebarRooms.filter(item => !item.archivedAt)[Number(event.key) - 1]
      if (room === undefined) return
      event.preventDefault()
      store.select(room.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, goalOpen, sidebarRooms, store])

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
  const goalDialogNode = h(NewGoalDialog, {
    open: goalOpen,
    onClose: closeGoal,
    onSubmit: startGoal,
    onDiscuss: discussGoal,
    onAdjust: adjustGoal,
  })

  const firstRun = state.rooms.length === 0
  return h('div', { className: 'dsb-frame', 'data-solo': firstRun ? 'true' : undefined },
    connectionBanner,
    firstRun
      ? null
      : h(Sidebar, {
        state: { ...state, rooms: sidebarRooms },
        onSelect: id => store.select(id),
        onNew: openGoal,
        onRename: (id, name) => store.renameRoom(id, name),
        onArchive: (id, archived) => store.archiveRoom(id, archived),
        onDelete: id => store.deleteRoom(id),
      }),
    room === null
      ? h(HomeView, {
        onSubmit: startGoal,
        onSample: kind => { void store.openSampleRoom(kind) },
        onDiscuss: discussGoal,
        onAdjust: adjustGoal,
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
    dialogNode,
    goalDialogNode)
}
